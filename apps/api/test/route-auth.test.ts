import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoginDeps } from '../src/auth/github-login.js';
import { createSession, csrfToken } from '../src/auth/session.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import type { ApiDeps } from '../src/routes/api.js';
import { buildServer } from '../src/server.js';

/**
 * The single source of truth for route authentication. Every registered route must appear here:
 * public = no credential, user = session (or HMAC for the webhook), user+csrf = session plus
 * x-csrf-token, admin = admin session (plus CSRF on mutations).
 *
 * Adding a route without adding it to this table fails the "matches the registered routes" test.
 */
type Level = 'public' | 'user' | 'user+csrf' | 'admin';
interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  level: Level;
}
const routes: Route[] = [
  { method: 'GET', path: '/livez', level: 'public' },
  { method: 'GET', path: '/readyz', level: 'public' },
  { method: 'GET', path: '/health', level: 'public' },
  // The webhook's credential is an HMAC signature instead of a session.
  { method: 'POST', path: '/github/webhooks', level: 'user' },
  { method: 'GET', path: '/auth/login', level: 'public' },
  { method: 'GET', path: '/auth/callback', level: 'public' },
  { method: 'GET', path: '/auth/me', level: 'user' },
  { method: 'POST', path: '/auth/logout', level: 'user+csrf' },
  { method: 'POST', path: '/wallet/challenge', level: 'user+csrf' },
  { method: 'POST', path: '/wallet/verify', level: 'user+csrf' },
  { method: 'DELETE', path: '/wallet', level: 'user+csrf' },
  { method: 'GET', path: '/config', level: 'public' },
  { method: 'GET', path: '/filters', level: 'public' },
  { method: 'GET', path: '/bounties', level: 'public' },
  { method: 'GET', path: '/bounties/:id', level: 'public' },
  { method: 'GET', path: '/me/earnings', level: 'user' },
  { method: 'GET', path: '/me/funded', level: 'user' },
  { method: 'GET', path: '/users/:login', level: 'public' },
  { method: 'GET', path: '/intents/:id', level: 'public' },
  { method: 'POST', path: '/intents/:id/build', level: 'user+csrf' },
  { method: 'POST', path: '/tx/submit', level: 'user+csrf' },
  { method: 'POST', path: '/bounties/:id/release/build', level: 'user+csrf' },
  { method: 'POST', path: '/bounties/:id/refund/build', level: 'user+csrf' },
  { method: 'GET', path: '/admin/disputes', level: 'admin' },
  { method: 'POST', path: '/admin/disputes/:id/open-onchain', level: 'admin' },
  { method: 'POST', path: '/admin/disputes/:id/resolve/build', level: 'admin' },
  { method: 'POST', path: '/admin/disputes/:id/reject', level: 'admin' },
  { method: 'GET', path: '/admin/payouts', level: 'admin' },
  { method: 'POST', path: '/admin/payouts/:id/retry', level: 'admin' },
  { method: 'GET', path: '/admin/status', level: 'admin' },
];

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());
const cfg = loadConfig({ DATABASE_URL: 'x', BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V', SESSION_SECRET: 's'.repeat(32), CSRF_SECRET: 'c'.repeat(32), GITHUB_WEBHOOK_SECRET: 'hooksecret', LOG_LEVEL: 'silent' });

const chain: NonNullable<ApiDeps['chain']> = {
  buildFundTx: async () => 'x',
  buildReleaseTx: async () => 'x',
  buildRefundTx: async () => 'x',
  submitSigned: async () => 'h',
  getBounty: async () => ({ status: 'Open' }),
  buildOpenDisputeTx: async () => 'OPENXDR',
  buildResolveTx: async () => 'RESXDR',
};
const login: LoginDeps = {
  db,
  clientId: 'client',
  clientSecret: 'secret',
  callbackUrl: 'https://api.example/auth/callback',
  webUrl: 'https://app.example',
  secret: 's'.repeat(32),
  adminGithubIds: [],
};
const app = () => buildServer(cfg, { insert: async () => true, enqueue: async () => {} }, { db, csrfSecret: cfg.CSRF_SECRET, chain, login });

let githubId = 0n;
async function credentials(isAdmin = false) {
  const u = await db.user.create({ data: { githubId: ++githubId, githubLogin: `u${githubId}`, isAdmin } });
  const id = (await createSession(db, u.id)).id;
  return { cookie: `se_session=${id}`, csrf: csrfToken(cfg.CSRF_SECRET, id) };
}

/** Placeholder params: enough to reach the handler, never enough to mutate money state. */
const url = (path: string) =>
  path
    .replace('/bounties/:id', '/bounties/0')
    .replace(':login', 'nobody')
    .replaceAll(':id', 'abcdefghijk');

function call(a: FastifyInstance, route: Route, headers: Record<string, string> = {}) {
  return a.inject({
    method: route.method,
    url: url(route.path),
    headers: route.method === 'POST' ? { 'content-type': 'application/json', ...headers } : headers,
    payload: route.method === 'POST' ? '{}' : undefined,
  });
}
const expectAllowed = (status: number, label: string) => {
  expect(status, label).not.toBe(401);
  expect(status, label).not.toBe(403);
};
const sign = (body: string) => `sha256=${createHmac('sha256', cfg.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`;

beforeEach(async () => {
  githubId = 0n;
  await db.$executeRawUnsafe('TRUNCATE "Payout","PullRequestBounty","PullRequest","Bounty","Repo","Installation","WalletChallenge","Session","User" CASCADE');
});

describe('route authentication matrix', () => {
  it('matches the registered routes (fails when a new route is not classified)', async () => {
    const a = await app();
    await a.ready();
    // With commonPrefix disabled every leaf prints its full path and its methods, e.g.
    // "└── /auth/me (GET, HEAD)". HEAD siblings of GET routes are implicit, not auth decisions.
    const registered = a
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .flatMap((line) => {
        const match = /^\s*[├└]──\s+(\S+)\s+\(([^)]+)\)/.exec(line);
        if (!match) return [];
        const [, path, methods] = match as [string, string, string];
        return methods
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m !== 'HEAD')
          .map((method) => `${method} ${path}`);
      })
      .sort();
    expect(registered).toEqual(routes.map((r) => `${r.method} ${r.path}`).sort());
  });

  it.each(routes)('$method $path requires $level', async (route) => {
    const a = await app();
    const label = `${route.method} ${route.path}`;

    if (route.level === 'public') {
      expectAllowed((await call(a, route)).statusCode, label);
      return;
    }

    // No credential is always rejected with 401 (an invalid signature for the webhook).
    expect((await call(a, route)).statusCode, `${label} without credentials`).toBe(401);

    if (route.path === '/github/webhooks') {
      expect((await call(a, route, { 'x-hub-signature-256': 'sha256=deadbeef' })).statusCode, `${label} bad signature`).toBe(401);
      expectAllowed((await call(a, route, { 'x-hub-signature-256': sign('{}') })).statusCode, `${label} good signature`);
      return;
    }

    if (route.level === 'user') {
      expect((await call(a, route, { cookie: 'se_session=nothex' })).statusCode, `${label} bad session`).toBe(401);
      const { cookie } = await credentials();
      expectAllowed((await call(a, route, { cookie })).statusCode, `${label} with session`);
      return;
    }

    const needsCsrf = route.level === 'user+csrf' || route.method !== 'GET';
    const user = await credentials(route.level === 'admin');

    if (needsCsrf) {
      expect((await call(a, route, { cookie: user.cookie })).statusCode, `${label} without CSRF`).toBe(403);
      expect((await call(a, route, { cookie: user.cookie, 'x-csrf-token': 'bad' })).statusCode, `${label} bad CSRF`).toBe(403);
    }

    if (route.level === 'admin') {
      const nonAdmin = await credentials(false);
      expect((await call(a, route, { cookie: nonAdmin.cookie, 'x-csrf-token': nonAdmin.csrf })).statusCode, `${label} non-admin`).toBe(403);
      expect((await call(a, route, { cookie: nonAdmin.cookie })).statusCode, `${label} non-admin without CSRF`).toBe(403);
    }

    expectAllowed((await call(a, route, { cookie: user.cookie, 'x-csrf-token': user.csrf })).statusCode, `${label} with credentials`);
  });
});
