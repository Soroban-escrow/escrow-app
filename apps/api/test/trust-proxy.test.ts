import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig, parseTrustProxy } from '../src/config.js';
import { buildServer, type DeliveryStore } from '../src/server.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  GITHUB_WEBHOOK_SECRET: 'hooksecret',
  LOG_LEVEL: 'silent',
};

const store: DeliveryStore = { insert: async () => true, enqueue: async () => undefined };

describe('parseTrustProxy', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['1', 1],
    [' 2 ', 2],
    ['10', 10],
  ])('%j trusts %j', (raw, value) => {
    expect(parseTrustProxy(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['10.0.0.1, 192.168.0.0/16', ['10.0.0.1', '192.168.0.0/16']],
    ['10.0.0.1 10.0.0.2', ['10.0.0.1', '10.0.0.2']],
    ['LOOPBACK,uniquelocal', ['loopback', 'uniquelocal']],
    ['fd00::/8', ['fd00::/8']],
    ['2001:db8::1', ['2001:db8::1']],
  ])('accepts the address list %j', (raw, value) => {
    expect(parseTrustProxy(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ['true', /spoof/],
    ['0.0.0.0/0', /spoof/],
    ['::/0', /spoof/],
    ['11', /between 1 and 10/],
    ['banana', /not an IP address/],
    ['300.1.1.1', /not an IP address/],
    ['10.0.0.0/33', /invalid prefix/],
    ['10.0.0.0/x', /invalid prefix/],
    ['10.0.0.0/8/8', /not an IP address/],
    ['1.2.3.4, nonsense', /nonsense/],
  ])('rejects %j', (raw, message) => {
    const result = parseTrustProxy(raw);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(message);
  });
});

describe('TRUST_PROXY config', () => {
  it('defaults to trusting no proxy', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false);
  });

  it('accepts a hop count or a CIDR list', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8,172.16.0.0/12' }).TRUST_PROXY).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });

  it('refuses to start with a value that would trust every client', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: '0.0.0.0/0' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'nonsense' })).toThrow(/TRUST_PROXY/);
  });
});

async function ipApp(extra: Record<string, string> = {}): Promise<FastifyInstance> {
  const app = await buildServer(loadConfig({ ...base, ...extra }), store);
  app.get('/ip', async (req) => ({ ip: req.ip }));
  return app;
}

/** A request that reached the API through a proxy at `remoteAddress`, carrying `forwardedFor`. */
const via = (app: FastifyInstance, forwardedFor?: string, remoteAddress = '10.0.0.1') =>
  app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} });

const clientIp = async (app: FastifyInstance, forwardedFor?: string, remoteAddress?: string) =>
  (await via(app, forwardedFor, remoteAddress)).json().ip;

describe('client IP behind a proxy', () => {
  it('without TRUST_PROXY, req.ip is the proxy and X-Forwarded-For is ignored', async () => {
    const app = await ipApp();
    expect(await clientIp(app, '203.0.113.7')).toBe('10.0.0.1');
  });

  it('with a hop count, req.ip is the client the trusted proxy saw', async () => {
    const app = await ipApp({ TRUST_PROXY: '1' });
    expect(await clientIp(app, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('with a hop count, client-forged leading entries are ignored', async () => {
    const app = await ipApp({ TRUST_PROXY: '1' });
    expect(await clientIp(app, '1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('with no X-Forwarded-For header, falls back to the connection address', async () => {
    const app = await ipApp({ TRUST_PROXY: '1' });
    expect(await clientIp(app)).toBe('10.0.0.1');
  });

  it('with a CIDR list, walks past every trusted proxy to the client', async () => {
    const app = await ipApp({ TRUST_PROXY: '10.0.0.0/8' });
    expect(await clientIp(app, '203.0.113.7, 10.0.0.2')).toBe('203.0.113.7');
  });

  it('a direct client outside the trusted list cannot spoof its IP', async () => {
    const app = await ipApp({ TRUST_PROXY: '10.0.0.0/8' });
    expect(await clientIp(app, '1.2.3.4', '198.51.100.9')).toBe('198.51.100.9');
  });
});

describe('rate limiting by real client IP', () => {
  const remaining = (res: { headers: Record<string, unknown> }) => Number(res.headers['x-ratelimit-remaining']);

  it('with TRUST_PROXY, each client behind the proxy has its own limit', async () => {
    const app = await ipApp({ TRUST_PROXY: '1' });
    const first = await via(app, '203.0.113.1');
    const other = await via(app, '203.0.113.2');
    const firstAgain = await via(app, '203.0.113.1');
    expect([remaining(first), remaining(other), remaining(firstAgain)]).toEqual([299, 299, 298]);
  });

  it('without it, every client behind the proxy shares one limit (the bug)', async () => {
    const app = await ipApp();
    const first = await via(app, '203.0.113.1');
    const other = await via(app, '203.0.113.2');
    expect([remaining(first), remaining(other)]).toEqual([299, 298]);
  });

  it('one client exhausting its limit does not block another', async () => {
    const app = await ipApp({ TRUST_PROXY: '1' });
    let last = await via(app, '203.0.113.1');
    for (let i = 0; i < 300; i += 1) last = await via(app, '203.0.113.1');
    expect(last.statusCode).toBe(429);
    expect((await via(app, '203.0.113.2')).statusCode).toBe(200);
  });
});
