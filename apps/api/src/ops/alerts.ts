import type { Db } from '../db.js';
import { DISPUTE_REVIEW_HOURS } from '../disputes.js';

export interface AlertInputs {
  db: Db;
  now?: () => Date;
  relayerBalanceXlm?: number;
  minRelayerXlm: number;
  /** latest ledger on the network, to measure indexer lag */
  latestLedger?: number;
}

const HOUR_MS = 3600e3;

const RUNBOOK_URL = 'docs/RUNBOOK.md';

/** Pure-ish check: returns the human-readable alerts that apply right now. */
export async function collectAlerts(a: AlertInputs): Promise<string[]> {
  const now = (a.now ?? (() => new Date()))();
  const out: string[] = [];
  if (a.relayerBalanceXlm !== undefined && a.relayerBalanceXlm < a.minRelayerXlm) {
    out.push(`Relayer balance low: ${a.relayerBalanceXlm.toFixed(2)} XLM (alert below ${a.minRelayerXlm}) — see ${RUNBOOK_URL}#alert-relayer-balance-low`);
  }
  const failed = await a.db.payout.count({ where: { status: 'FAILED' } });
  if (failed > 0) out.push(`${failed} payout(s) FAILED and need attention — see ${RUNBOOK_URL}#alert-payouts-failed`);

  const cursor = await a.db.indexerCursor.findUnique({ where: { id: 'bounty_escrow' } });
  if (a.latestLedger !== undefined && cursor && a.latestLedger - cursor.ledger > 60) {
    // 60 ledgers is about 5 minutes
    out.push(`Indexer is ${a.latestLedger - cursor.ledger} ledgers behind — see ${RUNBOOK_URL}#alert-indexer-lag`);
  }
  const stale = await a.db.dispute.count({ where: { status: { in: ['requested', 'opened_onchain'] }, createdAt: { lt: new Date(now.getTime() - DISPUTE_REVIEW_HOURS * HOUR_MS) } } });
  if (stale > 0) out.push(`${stale} dispute(s) older than ${DISPUTE_REVIEW_HOURS} h — see ${RUNBOOK_URL}#alert-disputes-overdue`);

  // merged-but-unpaid PRs whose refund window opens within 72 h: the arbiter may need to act
  const risky = await a.db.payout.findMany({
    where: { status: { in: ['PENDING_WALLET', 'AWAITING_MAINTAINER', 'FAILED'] }, bounty: { status: 'OPEN', deadline: { lt: new Date(now.getTime() + 72 * HOUR_MS) } } },
    include: { bounty: { select: { id: true, deadline: true } } },
  });
  for (const p of risky) out.push(`Bounty ${p.bounty.id} has a merged PR (${p.status}) and its refund window is near — see ${RUNBOOK_URL}#alert-refund-window-near`);
  return out;
}

/** Sends alerts to the webhook, at most once per message per cooldown. */
export function alertSender(url: string | undefined, log: (m: string, x?: unknown) => void, cooldownMs = HOUR_MS, fetchImpl: typeof fetch = fetch) {
  const sent = new Map<string, number>();
  return async (messages: string[], now = Date.now()) => {
    for (const m of messages) {
      const last = sent.get(m);
      if (last !== undefined && last + cooldownMs > now) continue;
      sent.set(m, now);
      log('ALERT', m);
      if (url) await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `SkillEscrow: ${m}` }) }).catch(() => {});
    }
  };
}
