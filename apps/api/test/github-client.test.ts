import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGithubClient, GithubError } from '../src/github/client.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pub = publicKey;

interface Call { method: string; path: string; auth: string; body?: unknown }
function fakeGithub(opts: { tokenTtlMs?: number; rejectFirstUse?: boolean } = {}) {
  const calls: Call[] = [];
  let issued = 0; let clock = 1_800_000_000_000; let rejected = false;
  const routes: Record<string, (c: Call) => { status: number; json?: unknown }> = {};
  const fetchImpl = (async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(url); const method = init.method ?? 'GET'; const auth = init.headers.authorization ?? '';
    const call: Call = { method, path: u.pathname + u.search, auth, ...(init.body ? { body: JSON.parse(init.body) } : {}) };
    calls.push(call);
    let out: { status: number; json?: unknown };
    if (u.pathname === '/app/installations/9/access_tokens') {
      // verify the app JWT: RS256 signature, issuer, lifetime
      const [h, p, s] = auth.replace('Bearer ', '').split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(pub, s!, 'base64url');
      const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
      if (!ok || claims.iss !== '123' || claims.exp - claims.iat > 600) out = { status: 401 };
      else out = { status: 201, json: { token: `tok${++issued}`, expires_at: new Date(clock + (opts.tokenTtlMs ?? 3_600_000)).toISOString() } };
    } else if (opts.rejectFirstUse && !rejected && auth === 'Bearer tok1') { rejected = true; out = { status: 401 }; }
    else out = (routes[`${method} ${u.pathname}`] ?? (() => ({ status: 404 })))(call);
    return { ok: out.status < 300, status: out.status, json: async () => out.json } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, routes, fetchImpl, advance: (ms: number) => { clock += ms; }, now: () => clock };
}
const make = (g: ReturnType<typeof fakeGithub>) => createGithubClient({ appId: '123', privateKey: PEM, fetchImpl: g.fetchImpl, now: g.now });

describe('installation tokens', () => {
  it('signs a valid app JWT, caches the token, and refreshes it near expiry', async () => {
    const g = fakeGithub({ tokenTtlMs: 600_000 });
    g.routes['GET /repos/o/r/collaborators/alice/permission'] = () => ({ status: 200, json: { permission: 'write' } });
    const c = make(g);
    expect(await c.getPermission(9n, 'o/r', 'alice')).toBe('write');
    await c.getPermission(9n, 'o/r', 'alice');
    expect(g.calls.filter((x) => x.path.includes('access_tokens'))).toHaveLength(1);
    g.advance(560_000); // inside the 60 s safety margin
    await c.getPermission(9n, 'o/r', 'alice');
    expect(g.calls.filter((x) => x.path.includes('access_tokens'))).toHaveLength(2);
    expect(g.calls.at(-1)!.auth).toBe('Bearer tok2');
  });
  it('coalesces concurrent refreshes of an expired token into a single request', async () => {
    const g = fakeGithub({ tokenTtlMs: 600_000 });
    g.routes['GET /repos/o/r/collaborators/alice/permission'] = () => ({ status: 200, json: { permission: 'write' } });
    const c = make(g);
    expect(await c.getPermission(9n, 'o/r', 'alice')).toBe('write');
    expect(g.calls.filter((x) => x.path.includes('access_tokens'))).toHaveLength(1);
    g.advance(600_000); // token is expired: inside the 60 s refresh window
    const results = await Promise.all(Array.from({ length: 10 }, () => c.getPermission(9n, 'o/r', 'alice')));
    expect(results).toEqual(Array<string>(10).fill('write'));
    const tokenRequests = g.calls.filter((x) => x.path.includes('access_tokens'));
    expect(tokenRequests).toHaveLength(2); // one initial token + one shared refresh
    const permissionCalls = g.calls.filter((x) => x.path.includes('/collaborators/alice/permission'));
    expect(permissionCalls.slice(-10).every((x) => x.auth === 'Bearer tok2')).toBe(true);
  });
  it('retries once with a fresh token after a 401', async () => {
    const g = fakeGithub({ rejectFirstUse: true });
    g.routes['GET /repos/o/r/collaborators/alice/permission'] = () => ({ status: 200, json: { permission: 'admin' } });
    expect(await make(g).getPermission(9n, 'o/r', 'alice')).toBe('admin');
    expect(g.calls.filter((x) => x.path.includes('access_tokens'))).toHaveLength(2);
  });
  it('fails clearly when the installation token cannot be issued', async () => {
    const g = fakeGithub();
    const c = createGithubClient({ appId: '999', privateKey: PEM, fetchImpl: g.fetchImpl, now: g.now }); // wrong app id: fake rejects the JWT
    await expect(c.getPermission(9n, 'o/r', 'alice')).rejects.toBeInstanceOf(GithubError);
  });
  it('accepts a private key with literal \\n sequences (as stored in .env)', async () => {
    const g = fakeGithub();
    g.routes['GET /repos/o/r/collaborators/a/permission'] = () => ({ status: 200, json: { permission: 'read' } });
    const c = createGithubClient({ appId: '123', privateKey: PEM.trim().replace(/\n/g, '\\n'), fetchImpl: g.fetchImpl, now: g.now });
    expect(await c.getPermission(9n, 'o/r', 'a')).toBe('read');
  });
});

describe('calls', () => {
  it('permission 404 means none; other errors throw', async () => {
    const g = fakeGithub();
    g.routes['GET /repos/o/r/collaborators/stranger/permission'] = () => ({ status: 404 });
    g.routes['GET /repos/o/r/collaborators/boom/permission'] = () => ({ status: 500 });
    const c = make(g);
    expect(await c.getPermission(9n, 'o/r', 'stranger')).toBe('none');
    await expect(c.getPermission(9n, 'o/r', 'boom')).rejects.toThrow(/500/);
  });
  it('posts and updates comments', async () => {
    const g = fakeGithub();
    g.routes['POST /repos/o/r/issues/7/comments'] = (c) => ({ status: 201, json: { id: 4242, body: (c.body as { body: string }).body } });
    g.routes['PATCH /repos/o/r/issues/comments/4242'] = () => ({ status: 200, json: {} });
    const c = make(g);
    expect(await c.postComment(9n, 'o/r', 7, 'hello')).toBe(4242n);
    await c.updateComment(9n, 'o/r', 4242n, 'edited');
    expect(g.calls.at(-1)!.body).toEqual({ body: 'edited' });
  });
  it('sets the bounty label: removes older ones, tolerates an existing label, then applies', async () => {
    const g = fakeGithub();
    g.routes['GET /repos/o/r/issues/7/labels'] = () => ({ status: 200, json: [{ name: 'bounty: 10 USDC' }, { name: 'bug' }] });
    g.routes['DELETE /repos/o/r/issues/7/labels/bounty%3A%2010%20USDC'] = () => ({ status: 200, json: [] });
    g.routes['POST /repos/o/r/labels'] = () => ({ status: 422 });
    g.routes['POST /repos/o/r/issues/7/labels'] = () => ({ status: 200, json: [] });
    await make(g).setBountyLabel(9n, 'o/r', 7, 'bounty: 50 USDC');
    expect(g.calls.some((x) => x.method === 'DELETE' && x.path.endsWith('bounty%3A%2010%20USDC'))).toBe(true);
    expect(g.calls.at(-1)!.body).toEqual({ labels: ['bounty: 50 USDC'] });
  });
  it('makes no changes when the issue already has exactly the target bounty label', async () => {
    const g = fakeGithub();
    g.routes['GET /repos/o/r/readme'] = () => ({ status: 404 });
    const c = make(g);
    await c.getReadmeExcerpt(9n, 'o/r'); // cache the installation token
    g.calls.length = 0;
    g.routes['GET /repos/o/r/issues/7/labels'] = () => ({ status: 200, json: [{ name: 'bug' }, { name: 'bounty: 50 USDC' }] });
    await c.setBountyLabel(9n, 'o/r', 7, 'bounty: 50 USDC');
    expect(g.calls).toHaveLength(1); // only the labels GET
    expect(g.calls[0]!.method).toBe('GET');
    expect(g.calls[0]!.path).toContain('/issues/7/labels?per_page=100');
  });
  it('clears every bounty label from the issue', async () => {
    const g = fakeGithub();
    g.routes['GET /repos/o/r/issues/7/labels'] = () => ({
      status: 200, json: [{ name: 'bounty: 50 USDC' }, { name: 'bug' }, { name: 'bounty: 30 XLM' }],
    });
    g.routes['DELETE /repos/o/r/issues/7/labels/bounty%3A%2050%20USDC'] = () => ({ status: 200, json: [] });
    g.routes['DELETE /repos/o/r/issues/7/labels/bounty%3A%2030%20XLM'] = () => ({ status: 200, json: [] });
    await make(g).clearBountyLabel(9n, 'o/r', 7);
    expect(g.calls.filter((x) => x.method === 'DELETE').map((x) => x.path)).toEqual([
      '/repos/o/r/issues/7/labels/bounty%3A%2050%20USDC',
      '/repos/o/r/issues/7/labels/bounty%3A%2030%20XLM',
    ]);
  });
  it('lists installations across every page', async () => {
    const g = fakeGithub();
    const inst = (id: number) => ({ id, account: { login: 'o', type: 'User' }, suspended_at: null });
    g.routes['GET /app/installations'] = (c) => ({
      status: 200,
      json: new URLSearchParams(c.path.split('?')[1]).get('page') === '1'
        ? Array.from({ length: 100 }, (_, i) => inst(i + 1))
        : [inst(101)],
    });
    const all = await make(g).listInstallations();
    expect(all).toHaveLength(101);
    expect(all.at(-1)!.id).toBe(101);
    expect(g.calls.filter((x) => x.path.startsWith('/app/installations?'))).toHaveLength(2);
  });
  it('lists all repositories, following total_count across pages', async () => {
    const g = fakeGithub();
    const repo = (id: number) => ({ id, full_name: `o/r${id}`, private: false });
    g.routes['GET /installation/repositories'] = (c) => ({
      status: 200,
      json: new URLSearchParams(c.path.split('?')[1]).get('page') === '1'
        ? { total_count: 105, repositories: Array.from({ length: 100 }, (_, i) => repo(i + 1)) }
        : { total_count: 105, repositories: Array.from({ length: 5 }, (_, i) => repo(i + 101)) },
    });
    const all = await make(g).listRepositories(9n);
    expect(all).toHaveLength(105);
    expect(all.map((r) => r.id)).toEqual(Array.from({ length: 105 }, (_, i) => i + 1));
    expect(g.calls.filter((x) => x.path.startsWith('/installation/repositories?'))).toHaveLength(2);
  });
  it('reads PR files across pages and combines check runs with commit statuses', async () => {
    const g = fakeGithub();
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}`, additions: 1, deletions: 0, patch: '+x' }));
    g.routes['GET /repos/o/r/pulls/3/files'] = (c) => ({ status: 200, json: new URLSearchParams(c.path.split('?')[1]).get('page') === '1' ? page(100) : page(5) });
    expect(await make(g).getPullFiles(9n, 'o/r', 3)).toHaveLength(105);
    const checks = (runs: object[]) => { g.routes['GET /repos/o/r/commits/abc1234/check-runs'] = (c) => {
      const pageNumber = Number(new URLSearchParams(c.path.split('?')[1]).get('page'));
      return { status: 200, json: { total_count: runs.length, check_runs: pageNumber === 1 ? runs : [] } };
    }; };
    const status = (state: string, total_count = 1) => { g.routes['GET /repos/o/r/commits/abc1234/status'] = () => ({ status: 200, json: { state, total_count } }); };
    checks([]); status('success', 0);
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('none');
    status('pending');
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('pending');
    checks([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'skipped' }]); status('success', 0);
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('success');
    checks([{ status: 'in_progress', conclusion: null }]); status('success');
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('pending');
    checks([{ status: 'completed', conclusion: 'success' }]); status('failure');
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('failure');
    checks([{ status: 'completed', conclusion: 'failure' }]); status('pending');
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('failure');
    checks(Array.from({ length: 101 }, () => ({ status: 'completed', conclusion: 'success' }))); status('success', 0);
    g.routes['GET /repos/o/r/commits/abc1234/check-runs'] = (c) => {
      const pageNumber = Number(new URLSearchParams(c.path.split('?')[1]).get('page'));
      return { status: 200, json: { total_count: 101, check_runs: pageNumber === 1 ? Array.from({ length: 100 }, () => ({ status: 'completed', conclusion: 'success' })) : [{ status: 'completed', conclusion: 'success' }] } };
    };
    expect(await make(g).getCiConclusion(9n, 'o/r', 'abc1234')).toBe('success');
    expect(g.calls.filter((x) => x.path.includes('/check-runs?')).slice(-2).map((x) => x.path)).toEqual([
      '/repos/o/r/commits/abc1234/check-runs?per_page=100&page=1',
      '/repos/o/r/commits/abc1234/check-runs?per_page=100&page=2',
    ]);
  });
});

describe('input validation (no request is made)', () => {
  it('refuses path-injection attempts', async () => {
    const g = fakeGithub(); const c = make(g);
    await expect(c.getPermission(9n, 'o/r/../../x', 'a')).rejects.toThrow(/repository/);
    await expect(c.getPermission(9n, 'o/r', '../admin')).rejects.toThrow(/login/);
    await expect(c.postComment(9n, 'o/r', -1, 'x')).rejects.toThrow(/issue/);
    await expect(c.postComment(9n, 'o/r?x=1', 1, 'x')).rejects.toThrow(/repository/);
    await expect(c.getCiConclusion(9n, 'o/r', 'abc/../x')).rejects.toThrow(/sha/);
    await expect(c.setBountyLabel(9n, 'o/r', 1, 'evil; label')).rejects.toThrow(/label/);
    expect(g.calls).toHaveLength(0);
  });
});
