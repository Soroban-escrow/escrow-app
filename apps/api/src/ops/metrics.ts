import { createHash, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Db } from '../db.js';
import { CURSOR_ID } from '../indexer/indexer.js';
import { VERDICTS } from '../ai/schema.js';
import { WEBHOOKS } from '../worker/queue.js';
import { REVIEWS } from '../worker/review-queue.js';

/** Durable across API/worker instances as long as the Redis data survives. */
export const METRICS_KEY = 'skillescrow:metrics:jobs:v1';
export const PAYOUT_STATUSES = ['PENDING_WALLET', 'QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'AWAITING_MAINTAINER'] as const;
export const WEBHOOK_RESULTS = ['success', 'ignored', 'error'] as const;
export const REVIEW_OUTCOMES = ['reviewed', 'cached', 'draft', 'closed', 'rate_limited', 'no_bounty', 'no_pr', 'error'] as const;
export const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

type QueueState = (typeof QUEUE_STATES)[number];
type QueueCounts = Record<QueueState, number>;
export interface MetricsSnapshot {
  latestLedger: number;
  indexerLedger: number | null;
  payouts: Record<string, number>;
  reviewVerdicts: Record<string, number>;
  webhookQueue: QueueCounts;
  reviewQueue: QueueCounts;
  jobCounters: Record<string, string>;
}

const encodeLabel = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
const safeNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const help = (name: string, description: string, type: 'gauge' | 'counter') =>
  `# HELP ${name} ${description}\n# TYPE ${name} ${type}\n`;

/** Constant-time comparison avoids leaking the bearer token via early exits. */
export function authorizedMetricsRequest(expected: string | undefined, header: string | undefined): boolean {
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const candidate = header.slice('Bearer '.length);
  if (!candidate || candidate.includes(' ')) return false;
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(left, right);
}

export function renderMetrics(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  add(help('skillescrow_indexer_cursor_available', 'Whether an indexer cursor exists (1 or 0).', 'gauge'));
  add(`skillescrow_indexer_cursor_available ${snapshot.indexerLedger === null ? 0 : 1}\n`);
  add(help('skillescrow_indexer_lag_ledgers', 'Current Stellar ledger tip minus persisted indexer ledger.', 'gauge'));
  // Absence of an initial cursor is unknown, not zero lag.
  if (snapshot.indexerLedger !== null) add(`skillescrow_indexer_lag_ledgers ${Math.max(0, snapshot.latestLedger - snapshot.indexerLedger)}\n`);

  add(help('skillescrow_payouts', 'Current payout rows by status.', 'gauge'));
  for (const status of PAYOUT_STATUSES) add(`skillescrow_payouts{status="${status}"} ${safeNumber(snapshot.payouts[status])}\n`);
  add(help('skillescrow_ai_review_verdicts', 'Persisted AI reviews by verdict.', 'gauge'));
  for (const verdict of VERDICTS) add(`skillescrow_ai_review_verdicts{verdict="${verdict}"} ${safeNumber(snapshot.reviewVerdicts[verdict])}\n`);

  add(help('skillescrow_queue_jobs', 'Current BullMQ jobs by queue and state.', 'gauge'));
  for (const [name, counts] of [['webhooks', snapshot.webhookQueue], ['ai_review', snapshot.reviewQueue]] as const) {
    for (const state of QUEUE_STATES) add(`skillescrow_queue_jobs{queue="${name}",state="${state}"} ${safeNumber(counts[state])}\n`);
  }
  add(help('skillescrow_webhook_jobs_total', 'Webhook processing attempts by result since metric initialization.', 'counter'));
  for (const result of WEBHOOK_RESULTS) add(`skillescrow_webhook_jobs_total{result="${result}"} ${safeNumber(snapshot.jobCounters[`webhook:${result}`])}\n`);
  add(help('skillescrow_ai_reviews_total', 'AI review processing attempts by outcome since metric initialization.', 'counter'));
  for (const outcome of REVIEW_OUTCOMES) add(`skillescrow_ai_reviews_total{outcome="${encodeLabel(outcome)}"} ${safeNumber(snapshot.jobCounters[`review:${outcome}`])}\n`);
  return lines.join('');
}

/** Worker-side counters share Redis with the API scraper. Never use user-generated label values. */
export async function recordJobMetric(
  redis: Pick<Redis, 'hincrby'>,
  kind: 'webhook' | 'review',
  result: string,
): Promise<void> {
  const allowed: readonly string[] = kind === 'webhook' ? WEBHOOK_RESULTS : REVIEW_OUTCOMES;
  if (!allowed.includes(result)) throw new Error('unsupported job metric result');
  await redis.hincrby(METRICS_KEY, `${kind}:${result}`, 1);
}

/** Read point-in-time metrics from the DB, Stellar RPC, and the actual BullMQ queues. */
export async function collectMetrics(db: Db, latestLedger: () => Promise<number>, redisUrl: string): Promise<string> {
  const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1 });
  const webhookQueue = new Queue(WEBHOOKS, { connection: redis });
  const reviewQueue = new Queue(REVIEWS, { connection: redis });
  try {
    const [tip, cursor, payouts, reviews, webhookCounts, reviewCounts, jobCounters] = await Promise.all([
      latestLedger(),
      db.indexerCursor.findUnique({ where: { id: CURSOR_ID } }),
      db.payout.groupBy({ by: ['status'], _count: { _all: true } }),
      db.aiReview.groupBy({ by: ['verdict'], _count: { _all: true } }),
      webhookQueue.getJobCounts(...QUEUE_STATES),
      reviewQueue.getJobCounts(...QUEUE_STATES),
      redis.hgetall(METRICS_KEY),
    ]);
    if (!Number.isSafeInteger(tip) || tip < 0) throw new Error('Stellar RPC returned an invalid ledger');
    const queueCounts = (counts: Partial<Record<QueueState, number>>): QueueCounts => ({
      waiting: safeNumber(counts.waiting), active: safeNumber(counts.active),
      delayed: safeNumber(counts.delayed), failed: safeNumber(counts.failed),
    });
    return renderMetrics({
      latestLedger: tip,
      indexerLedger: cursor?.ledger ?? null,
      payouts: Object.fromEntries(payouts.map((p) => [p.status, p._count._all])),
      reviewVerdicts: Object.fromEntries(reviews.map((r) => [r.verdict, r._count._all])),
      webhookQueue: queueCounts(webhookCounts),
      reviewQueue: queueCounts(reviewCounts),
      jobCounters,
    });
  } finally {
    await Promise.allSettled([webhookQueue.close(), reviewQueue.close()]);
    redis.disconnect();
  }
}
