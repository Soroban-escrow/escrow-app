import type { rpc } from '@stellar/stellar-sdk';
import type { Db } from '../db.js';
import { applyEvent, type Outcome } from './apply.js';
import { decodeEvent } from './decode.js';

export const CURSOR_ID = 'bounty_escrow';

export interface AppliedBounty {
  bountyId: bigint;
  kinds: string[];
  kind?: string;
}

export interface IndexerDeps {
  db: Db;
  server: Pick<rpc.Server, 'getEvents' | 'getLatestLedger'>;
  contractId: string;
  /** called after each committed batch for events that changed state (coalesced per bounty) */
  onApplied?: (e: AppliedBounty) => void;
  /** called when events were skipped because the RPC no longer retains their ledgers */
  onAlert?: (message: string) => void;
  log?: (msg: string, extra?: unknown) => void;
}

/** Plain-object RPC rejections ({code, message}) are not Errors. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** The ledger sequence encoded in an RPC event cursor (TOID: ledger is the high 32 bits). */
export function cursorLedger(cursor: string): number {
  const toid = BigInt(cursor.split('-')[0] ?? '0');
  return Number(toid >> 32n);
}

/** Plain-object RPC rejections carry the retention error in `message`, not in a stack. */
export function isRetentionError(e: unknown): boolean {
  return /ledger range|retention|retained|startLedger|cursor|oldest ledger|too old/i.test(errorMessage(e));
}

const MAX_PAGES = 200;
const FALLBACK_LEDGER_WINDOW = 1000;

/**
 * The cursor is outside the RPC's retained window and events will be skipped. Record the
 * ledger gap durably (audit log) and surface it as an alert so the missing range can be
 * reindexed later — the DB is a cache, but a silent gap is not acceptable.
 */
async function recordRetentionGap(d: IndexerDeps, fromLedger: number, toLedger: number, reason: string): Promise<void> {
  const gap = Math.max(toLedger - fromLedger, 0);
  const extra = { fromLedger, toLedger, gap, reason };
  d.log?.('indexer retention gap: events skipped', extra);
  await d.db.auditLog.create({
    data: {
      actor: 'system',
      action: 'indexer.retention_gap',
      target: `indexer:${CURSOR_ID}`,
      data: { fromLedger, toLedger, gap, reason },
    },
  });
  d.onAlert?.(`Indexer skipped ${gap} ledger(s) (${fromLedger} → ${toLedger}) outside RPC retention — see docs/RUNBOOK.md#alert-indexer-retention-gap`);
}

type EventFilters = NonNullable<Parameters<IndexerDeps['server']['getEvents']>[0]['filters']>;

/** Fetches one page, recovering from a cursor that fell outside RPC retention. */
async function getEventsPage(
  d: IndexerDeps,
  saved: { cursor: string | null; ledger: number } | null,
  filters: EventFilters,
  startLedgerFallback?: number,
): Promise<rpc.Api.GetEventsResponse> {
  try {
    return saved?.cursor
      ? await d.server.getEvents({ filters, cursor: saved.cursor, limit: 200 })
      : await d.server.getEvents({ filters, startLedger: startLedgerFallback ?? (await d.server.getLatestLedger()).sequence - FALLBACK_LEDGER_WINDOW, limit: 200 });
  } catch (e) {
    if (!isRetentionError(e)) throw e;
    const msg = errorMessage(e);
    // A rejected cursor does not mean its ledger is gone: replay from the last stored
    // ledger first. applyEvent is idempotent, so this closes no gap when it is retained.
    if (saved) {
      try {
        d.log?.('cursor outside retained range; replaying from stored ledger', saved.ledger);
        return await d.server.getEvents({ filters, startLedger: saved.ledger, limit: 200 });
      } catch (retry) {
        if (!isRetentionError(retry)) throw retry;
      }
    }
    // The stored ledger is evicted too. Fall back further, but never silently: the
    // events between the stored ledger and the fallback are no longer in the cache.
    const fallback = startLedgerFallback ?? (await d.server.getLatestLedger()).sequence - FALLBACK_LEDGER_WINDOW;
    await recordRetentionGap(d, saved?.ledger ?? fallback, fallback, msg);
    return await d.server.getEvents({ filters, startLedger: fallback, limit: 200 });
  }
}

/** Coalesces applied events by bounty id so multiple events in one batch trigger one card refresh. */
export function coalesceApplied(applied: { bountyId: bigint; kind: string }[]): AppliedBounty[] {
  const map = new Map<bigint, string[]>();
  for (const a of applied) {
    const list = map.get(a.bountyId);
    if (list) {
      list.push(a.kind);
    } else {
      map.set(a.bountyId, [a.kind]);
    }
  }
  return Array.from(map.entries()).map(([bountyId, kinds]) => ({
    bountyId,
    kinds,
    kind: kinds[kinds.length - 1],
  }));
}

/**
 * Catches up to the chain tip. The RPC scans a bounded ledger range per request and may return
 * an empty page with an advanced cursor, so we page until the cursor reaches the latest ledger.
 * Each page and its cursor are committed in one transaction. Returns events seen.
 */
export async function pollOnce(d: IndexerDeps, startLedgerFallback?: number): Promise<number> {
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const saved = await d.db.indexerCursor.findUnique({ where: { id: CURSOR_ID } });
    const filters = [{ type: 'contract' as const, contractIds: [d.contractId] }];
    const res = await getEventsPage(d, saved, filters, startLedgerFallback);
    const applied: { bountyId: bigint; kind: string }[] = [];
    await d.db.$transaction(async (tx) => {
      // follow the cursor, not just events: a quiet contract must still show an up-to-date ledger (health, lag alerts)
      let ledger = Math.max(saved?.ledger ?? 0, cursorLedger(res.cursor));
      for (const raw of res.events) {
        if (raw.inSuccessfulContractCall === false) continue;
        const ev = decodeEvent(raw);
        ledger = Math.max(ledger, raw.ledger);
        if (!ev) continue;
        const out: Outcome = await applyEvent(tx, ev, { eventId: raw.id, txHash: raw.txHash, closedAt: new Date(raw.ledgerClosedAt), log: d.log });
        if (out === 'anomaly') d.log?.('anomalous event ignored', { id: raw.id, kind: ev.kind });
        if (out === 'applied') applied.push({ bountyId: ev.id, kind: ev.kind });
      }
      await tx.indexerCursor.upsert({
        where: { id: CURSOR_ID },
        create: { id: CURSOR_ID, cursor: res.cursor, ledger },
        update: { cursor: res.cursor, ledger },
      });
    });
    for (const a of coalesceApplied(applied)) d.onApplied?.(a);
    seen += res.events.length;
    const caughtUp = cursorLedger(res.cursor) >= res.latestLedger - 1 || res.cursor === saved?.cursor;
    if (res.events.length < 200 && caughtUp) break;
  }
  return seen;
}

export async function run(d: IndexerDeps, signal: AbortSignal, intervalMs = 5000): Promise<void> {
  while (!signal.aborted) {
    try {
      await pollOnce(d);
    } catch (e) {
      d.log?.('poll failed', errorMessage(e));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
