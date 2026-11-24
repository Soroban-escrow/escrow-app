import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallError, isPermanentModelError, isRetryableModelError } from '../src/ai/anthropic.js';
import { reviewProducer, reviewWorker } from '../src/worker/review-queue.js';

const mocks = vi.hoisted(() => ({
  processors: [] as Array<(job: { data: { prId: string; force: boolean } }) => Promise<unknown>>,
  adds: [] as Array<Record<string, unknown>>,
  existingJob: null as null | { getState: () => Promise<string> },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    async getJob() { return mocks.existingJob; }
    async add(_name: string, _data: unknown, opts: Record<string, unknown>) { mocks.adds.push(opts); }
    async close() {}
  },
  Worker: class {
    constructor(_name: string, processor: (job: { data: { prId: string; force: boolean } }) => Promise<unknown>) { mocks.processors.push(processor); }
    async close() {}
  },
  UnrecoverableError: class extends Error {},
}));

vi.mock('../src/worker/queue.js', () => ({ connection: () => ({ disconnect: () => {} }) }));

const job = { data: { prId: '42', force: false } };
const processor = () => {
  const p = mocks.processors.at(-1);
  if (!p) throw new Error('no review processor');
  return p;
};

beforeEach(() => {
  mocks.adds.length = 0;
  mocks.processors.length = 0;
  mocks.existingJob = null;
});

describe('isRetryableModelError', () => {
  it.each([
    { status: 429 },
    { status: 500 },
    { status: 529 },
    { type: 'overloaded_error' },
    { error: { type: 'overloaded_error' } },
    new ModelCallError('temporary', true),
  ])('retries transient failures %o', (e) => {
    expect(isRetryableModelError(e)).toBe(true);
  });

  it.each([
    { status: 400 },
    { status: 401 },
    { status: 422 },
    new z.ZodError([]),
    new ModelCallError('invalid request', false),
    new Error('unknown'),
  ])('does not retry permanent failures %o', (e) => {
    expect(isRetryableModelError(e)).toBe(false);
  });
});

describe('isPermanentModelError', () => {
  it.each([
    { status: 400 },
    { status: 422 },
    new z.ZodError([]),
    new ModelCallError('invalid request', false),
  ])('marks model failures as permanent %o', (e) => {
    expect(isPermanentModelError(e)).toBe(true);
  });

  it.each([
    { status: 429 },
    { status: 503 },
    new ModelCallError('temporary', true),
    new Error('unrelated worker failure'),
  ])('keeps non-permanent failures retryable %o', (e) => {
    expect(isPermanentModelError(e)).toBe(false);
  });
});

describe('reviewWorker error handling', () => {
  it('logs a permanent failure once and marks the job unrecoverable', async () => {
    const log = vi.fn();
    const w = reviewWorker('redis://unused', async () => { throw new ModelCallError('invalid request', false); }, log);
    await expect(processor()(job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('review failed permanently', { pr: '42', error: 'invalid request' });
    await w.close();
  });

  it('leaves retryable failures to the queue backoff', async () => {
    const log = vi.fn();
    const failure = new ModelCallError('rate limited', true);
    const w = reviewWorker('redis://unused', async () => { throw failure; }, log);
    await expect(processor()(job)).rejects.toBe(failure);
    expect(log).not.toHaveBeenCalled();
    await w.close();
  });

  it('keeps unrelated worker failures retryable', async () => {
    const log = vi.fn();
    const failure = new Error('database down');
    const w = reviewWorker('redis://unused', async () => { throw failure; }, log);
    await expect(processor()(job)).rejects.toBe(failure);
    expect(log).not.toHaveBeenCalled();
    await w.close();
  });
});

describe('review retry scheduling', () => {
  it('uses exponential backoff for both normal and queued successor reviews', async () => {
    const prod = reviewProducer('redis://unused');
    await prod.schedule(42n, 0);
    expect(mocks.adds.at(-1)).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });
    mocks.existingJob = { getState: async () => 'active' };
    await prod.schedule(43n, 0);
    expect(mocks.adds.at(-1)).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });
    await prod.close();
  });
});
