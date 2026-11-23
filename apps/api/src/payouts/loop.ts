import type { Db } from '../db.js';
import { relayRelease, type PayoutDeps } from './payout.js';
import type { RelayerPort } from './ports.js';

/** Exponential backoff between attempts of the same payout (2 s, 4 s, 8 s, ...). */
export const backoffMs = (attempts: number) => Math.min(2 ** Math.max(attempts, 1) * 1000, 5 * 60_000);

/**
 * One pass: process queued and submitted payouts one at a time (single signing account, so
 * sequence numbers never race). Backoff deadlines live on the Payout row, so a restart or
 * deploy cannot make every backing-off payout retry at once.
 *
 * `retryAt` is an optional in-memory mirror kept for callers that observe it; the query and
 * the persisted `nextAttemptAt` are the source of truth.
 */
export async function relayerPass(
  d: PayoutDeps & { db: Db }, r: RelayerPort, retryAt?: Map<string, number>, now = () => Date.now(), log?: (m: string, x?: unknown) => void,
): Promise<number> {
  const due = await d.db.payout.findMany({
    where: {
      status: { in: ['QUEUED', 'SUBMITTED'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date(now()) } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  let n = 0;
  for (const p of due) {
    n++;
    try {
      const res = await relayRelease(d, r, p.bountyId);
      retryAt?.delete(p.id);
      await d.db.payout.update({ where: { id: p.id }, data: { nextAttemptAt: null } });
      log?.('relayer', { bounty: String(p.bountyId), result: res });
    } catch (e) {
      const next = now() + backoffMs(p.attempts + 1);
      retryAt?.set(p.id, next);
      await d.db.payout.update({ where: { id: p.id }, data: { nextAttemptAt: new Date(next) } });
      log?.('relayer transient failure', { bounty: String(p.bountyId), nextAt: new Date(next).toISOString(), error: e instanceof Error ? e.message : String(e) });
    }
  }
  return n;
}

export async function runRelayer(d: PayoutDeps & { db: Db }, r: RelayerPort, signal: AbortSignal, intervalMs = 5000, log?: (m: string, x?: unknown) => void) {
  // No in-memory backoff state: a fresh process reads nextAttemptAt from the DB.
  while (!signal.aborted) {
    try { await relayerPass(d, r, undefined, Date.now, log); } catch (e) { log?.('relayer pass failed', e instanceof Error ? e.message : String(e)); }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
