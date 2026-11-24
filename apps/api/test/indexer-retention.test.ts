import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db.js';
import { CURSOR_ID, pollOnce } from '../src/indexer/indexer.js';

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "IndexerCursor","AuditLog"');
});

// a cursor as the real RPC returns it: TOID, ledger in the high 32 bits
const toid = (ledger: number) => `${(BigInt(ledger) << 32n).toString().padStart(19, '0')}-4294967295`;
const retentionError = { code: -32000, message: 'startLedger is older than the oldest retained ledger' };
const cursorAt = (ledger: number) => db.indexerCursor.upsert({
  where: { id: CURSOR_ID },
  create: { id: CURSOR_ID, cursor: toid(ledger), ledger },
  update: { cursor: toid(ledger), ledger },
});

describe('indexer retention error', () => {
  it('replays from the last stored ledger when the RPC still retains it', async () => {
    await cursorAt(100);
    const requested: { cursor?: string; startLedger?: number }[] = [];
    const server = {
      getLatestLedger: async () => ({ sequence: 5_000_000 }),
      getEvents: async (args: { cursor?: string; startLedger?: number }) => {
        requested.push(args);
        if (args.cursor) throw retentionError; // the cursor TOID is evicted
        return { events: [], cursor: toid(5_000_000), latestLedger: 5_000_000 };
      },
    };
    const onAlert = vi.fn();
    await pollOnce({ db, server: server as never, contractId: 'C', onAlert });

    // the stored ledger itself is still retained, so no events are skipped
    expect(requested).toHaveLength(2);
    expect(requested[1]!.startLedger).toBe(100);
    expect(onAlert).not.toHaveBeenCalled();
    expect(await db.auditLog.count()).toBe(0);
    const c = await db.indexerCursor.findUniqueOrThrow({ where: { id: CURSOR_ID } });
    expect(c.ledger).toBe(5_000_000);
  });

  it('alerts and audit-logs the ledger gap when it must fall back further', async () => {
    await cursorAt(100);
    const requested: { cursor?: string; startLedger?: number }[] = [];
    const server = {
      getLatestLedger: async () => ({ sequence: 5_000_000 }),
      getEvents: async (args: { cursor?: string; startLedger?: number }) => {
        requested.push(args);
        if (args.startLedger === 5_000_000 - 1000) return { events: [], cursor: toid(5_000_000), latestLedger: 5_000_000 };
        throw retentionError; // both the cursor and the stored ledger are evicted
      },
    };
    const onAlert = vi.fn();
    const log = vi.fn();
    await pollOnce({ db, server: server as never, contractId: 'C', onAlert, log });

    const startLedgers = requested.map((r) => r.startLedger);
    expect(startLedgers).toContain(100); // tried the last stored ledger first
    expect(startLedgers).toContain(4_999_000); // then fell back

    expect(onAlert).toHaveBeenCalledOnce();
    expect(onAlert.mock.calls[0]![0]).toContain('4998900');
    expect(onAlert.mock.calls[0]![0]).toContain('100 → 4999000');
    const entry = await db.auditLog.findFirstOrThrow();
    expect(entry).toMatchObject({ actor: 'system', action: 'indexer.retention_gap', target: 'indexer:bounty_escrow' });
    expect(entry.data).toMatchObject({ fromLedger: 100, toLedger: 4_999_000, gap: 4_998_900 });
  });
});
