import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildServer, type DeliveryStore } from '../src/server.js';
import { authorizedMetricsRequest, recordJobMetric, renderMetrics, type MetricsSnapshot } from '../src/ops/metrics.js';

const base = {
  DATABASE_URL: 'postgresql://unused',
  BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32),
  CSRF_SECRET: 'c'.repeat(32),
  GITHUB_WEBHOOK_SECRET: 'hooksecret',
  LOG_LEVEL: 'silent',
};
const store: DeliveryStore = { insert: async () => true, remove: async () => {}, enqueue: async () => {} };
const TOKEN = 'a'.repeat(40);

function snapshot(): MetricsSnapshot {
  return {
    latestLedger: 205, indexerLedger: 200,
    payouts: { FAILED: 3, QUEUED: 2 },
    reviewVerdicts: { likely_meets: 4, needs_human: 1 },
    webhookQueue: { waiting: 10, active: 1, delayed: 2, failed: 3 },
    reviewQueue: { waiting: 5, active: 1, delayed: 0, failed: 0 },
    jobCounters: { 'webhook:success': '9', 'webhook:error': '2', 'review:reviewed': '7' },
  };
}

describe('Prometheus metrics exposition', () => {
  it('renders operational gauges and persisted worker counters with fixed labels', () => {
    const output = renderMetrics(snapshot());
    expect(output).toContain('skillescrow_indexer_lag_ledgers 5');
    expect(output).toContain('skillescrow_payouts{status="FAILED"} 3');
    expect(output).toContain('skillescrow_payouts{status="CONFIRMED"} 0');
    expect(output).toContain('skillescrow_queue_jobs{queue="webhooks",state="waiting"} 10');
    expect(output).toContain('skillescrow_webhook_jobs_total{result="success"} 9');
    expect(output).toContain('skillescrow_ai_reviews_total{outcome="reviewed"} 7');
    expect(output).toContain('skillescrow_ai_review_verdicts{verdict="likely_meets"} 4');
    expect(output).toContain('# TYPE skillescrow_webhook_jobs_total counter');
  });

  it('does not incorrectly report zero lag if the indexer has never started', () => {
    const output = renderMetrics({ ...snapshot(), indexerLedger: null });
    expect(output).toContain('skillescrow_indexer_cursor_available 0');
    expect(output).not.toMatch(/^skillescrow_indexer_lag_ledgers \d+/m);
  });

  it('uses a timing-safe secret comparison and rejects malformed headers', () => {
    expect(authorizedMetricsRequest(TOKEN, 'Bearer ' + TOKEN)).toBe(true);
    expect(authorizedMetricsRequest(TOKEN, 'Bearer ' + 'b'.repeat(40))).toBe(false);
    expect(authorizedMetricsRequest(TOKEN, 'Basic ' + TOKEN)).toBe(false);
    expect(authorizedMetricsRequest(undefined, 'Bearer ' + TOKEN)).toBe(false);
  });

  it('records only enumerated results in Redis', async () => {
    const hincrby = vi.fn(async () => 1);
    await recordJobMetric({ hincrby } as never, 'webhook', 'success');
    expect(hincrby).toHaveBeenCalledWith('skillescrow:metrics:jobs:v1', 'webhook:success', 1);
    await expect(recordJobMetric({ hincrby } as never, 'webhook', 'wallet-123')).rejects.toThrow();
    expect(hincrby).toHaveBeenCalledTimes(1);
  });
});

describe('GET /metrics protection and failure modes', () => {
  it('is disabled unless a metric secret is configured', async () => {
    const app = await buildServer(loadConfig(base), store);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('does not invoke the collector for unauthenticated requests', async () => {
    const collector = vi.fn(async () => renderMetrics(snapshot()));
    const app = await buildServer(loadConfig({ ...base, METRICS_TOKEN: TOKEN }), store, undefined, undefined, collector);
    for (const authorization of [undefined, 'Bearer wrong', 'Basic ' + TOKEN]) {
      const res = await app.inject({ method: 'GET', url: '/metrics', headers: authorization ? { authorization } : {} });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain('skillescrow_');
    }
    expect(collector).not.toHaveBeenCalled();
    await app.close();
  });

  it('serves Prometheus text to the bearer token and returns 503 on collector errors', async () => {
    const collector = vi.fn(async () => renderMetrics(snapshot()));
    const app = await buildServer(loadConfig({ ...base, METRICS_TOKEN: TOKEN }), store, undefined, undefined, collector);
    const headers = { authorization: 'Bearer ' + TOKEN };
    const res = await app.inject({ method: 'GET', url: '/metrics', headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('skillescrow_indexer_lag_ledgers 5');
    collector.mockRejectedValueOnce(new Error('Redis down'));
    const failed = await app.inject({ method: 'GET', url: '/metrics', headers });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('Redis down');
    await app.close();
  });

  it('rejects an undersized metrics token on config load', () => {
    expect(() => loadConfig({ ...base, METRICS_TOKEN: 'short' })).toThrow(/METRICS_TOKEN/);
  });
});
