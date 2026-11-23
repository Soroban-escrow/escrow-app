import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildServer, type DeliveryStore } from '../src/server.js';

const env = {
  DATABASE_URL: 'postgresql://x',
  BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  GITHUB_WEBHOOK_SECRET: 'hooksecret',
  LOG_LEVEL: 'silent',
};

const store: DeliveryStore = { insert: async () => true, enqueue: async () => undefined };

const unhealthy = { ok: false, db: true, rpc: false, redis: true, indexerLagLedgers: null };

describe('liveness and readiness probes', () => {
  it('/livez is 200 and never runs the dependency checks', async () => {
    const health = vi.fn(async () => unhealthy);
    const app = await buildServer(loadConfig(env), store, undefined, health);
    const res = await app.inject({ method: 'GET', url: '/livez' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(health).not.toHaveBeenCalled();
  });

  it('/livez stays 200 when the RPC is down or the indexer is lagging', async () => {
    const app = await buildServer(loadConfig(env), store, undefined, async () => unhealthy);
    expect((await app.inject({ method: 'GET', url: '/livez' })).statusCode).toBe(200);
  });

  it('/readyz is 200 when the checks pass', async () => {
    const ok = { ok: true, db: true, rpc: true, redis: true, indexerLagLedgers: 3 };
    const app = await buildServer(loadConfig(env), store, undefined, async () => ok);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ok);
  });

  it('/readyz is 503 when a dependency check fails', async () => {
    const app = await buildServer(loadConfig(env), store, undefined, async () => unhealthy);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(unhealthy);
  });

  it('/health behaves like /readyz', async () => {
    const app = await buildServer(loadConfig(env), store, undefined, async () => unhealthy);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(unhealthy);
  });

  it('/livez is not rate limited', async () => {
    const app = await buildServer(loadConfig(env), store);
    // the global limit is 300 per minute
    const codes = await Promise.all(
      Array.from({ length: 320 }, () => app.inject({ method: 'GET', url: '/livez' }).then((r) => r.statusCode)),
    );
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});
