import { describe, expect, it, vi } from 'vitest';
import { parseReindexArgs, reindexFromLedger } from './reindex.js';

describe('reindex CLI (#153)', () => {
  it('refuses to run without --yes', () => {
    expect(() => parseReindexArgs(['--from-ledger', '1200'])).toThrow(/--yes/);
  });

  it('requires a valid --from-ledger integer', () => {
    expect(() => parseReindexArgs(['--yes'])).toThrow(/--from-ledger/);
    expect(() => parseReindexArgs(['--yes', '--from-ledger', 'abc'])).toThrow(/--from-ledger/);
    expect(parseReindexArgs(['--from-ledger', '5000', '--yes'])).toEqual({
      fromLedger: 5000,
      yes: true,
    });
    expect(parseReindexArgs(['--from-ledger=5000', '--yes'])).toEqual({
      fromLedger: 5000,
      yes: true,
    });
  });

  it('resets indexer-derived tables and cursor, then replays events from the given ledger', async () => {
    const calls: string[] = [];
    const tx = {
      dispute: { deleteMany: vi.fn(async () => { calls.push('dispute.deleteMany'); }) },
      payout: { deleteMany: vi.fn(async () => { calls.push('payout.deleteMany'); }) },
      pullRequestBounty: { deleteMany: vi.fn(async () => { calls.push('pullRequestBounty.deleteMany'); }) },
      bounty: { deleteMany: vi.fn(async () => { calls.push('bounty.deleteMany'); }) },
      indexerCursor: {
        deleteMany: vi.fn(async () => { calls.push('indexerCursor.deleteMany'); }),
        upsert: vi.fn(async () => {}),
      },
    };
    const db = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      indexerCursor: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => ({ id: 'bounty_escrow', cursor: '100-1', ledger: 5000 })),
      },
    };
    const server = {
      getLatestLedger: vi.fn(async () => ({ sequence: 5001 })),
      getEvents: vi.fn(async () => ({
        events: [],
        cursor: '100-1',
        latestLedger: 5001,
      })),
    };

    const result = await reindexFromLedger(
      {
        db: db as never,
        server: server as never,
        contractId: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
      },
      { fromLedger: 5000, yes: true },
    );

    expect(calls).toEqual([
      'dispute.deleteMany',
      'payout.deleteMany',
      'pullRequestBounty.deleteMany',
      'bounty.deleteMany',
      'indexerCursor.deleteMany',
    ]);
    expect(server.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 5000 }),
    );
    expect(result).toEqual({ eventsReplayed: 0, batches: 1 });
  });
});
