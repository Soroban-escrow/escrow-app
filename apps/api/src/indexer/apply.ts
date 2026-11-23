import { portion } from '@skillescrow/shared';
import { DisputeStatus, type Prisma } from '@prisma/client';
import type { ChainEvent } from './decode.js';
import { issueUrl } from '../github/issue-url.js';

export interface EventMeta {
  eventId: string;
  txHash: string;
  closedAt: Date;
  log?: (msg: string, extra?: unknown) => void;
}

export type Outcome = 'applied' | 'stale' | 'untracked' | 'anomaly';

export function isStaleEventId(lastEventId: string | null | undefined, eventId: string): boolean {
  if (!lastEventId) return false;
  const parse = (id: string) => {
    const [toid, index = '0'] = id.split('-');
    if (!/^\d+$/.test(toid ?? '') || !/^\d+$/.test(index)) return null;
    return [BigInt(toid!), BigInt(index!)] as const;
  };
  const last = parse(lastEventId);
  const next = parse(eventId);
  if (!last || !next) return lastEventId >= eventId;
  if (last[0] !== next[0]) return last[0] > next[0];
  return last[1] >= next[1];
}

type FundedEvent = Extract<ChainEvent, { kind: 'funded' }>;
const BIGINT_TAG = '__bigint__';

/** JSON cannot represent bigints; tag them so a stored event round-trips exactly. */
const toJson = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value;
const fromJson = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) && BIGINT_TAG in value
    ? BigInt((value as Record<string, string>)[BIGINT_TAG]!)
    : value;

/** Serialize an untracked funded event together with the cursor metadata needed to replay it. */
export function encodeFundEvent(ev: FundedEvent, meta: EventMeta): string {
  return JSON.stringify({ ev, meta }, toJson);
}

export function decodeFundEvent(payload: string): { ev: FundedEvent; meta: EventMeta } {
  const parsed = JSON.parse(payload, fromJson) as { ev: FundedEvent; meta: Omit<EventMeta, 'closedAt'> & { closedAt: string } };
  return { ev: parsed.ev, meta: { ...parsed.meta, closedAt: new Date(parsed.meta.closedAt) } };
}

/**
 * Applies one event inside the caller's transaction. Idempotent: every bounty records the last
 * event applied, so replaying an old event is recognised as stale instead of re-applied.
 * Returns what happened so the caller can enqueue follow-up jobs only for 'applied'.
 */
export async function applyEvent(tx: Prisma.TransactionClient, ev: ChainEvent, meta: EventMeta): Promise<Outcome> {
  if (ev.kind === 'funded') {
    const repo = await tx.repo.findUnique({ where: { id: ev.repoId } });
    if (!repo) {
      // anyone can fund any repo on-chain; we only track installed ones. Keep the event so a
      // later installation can replay it — the cursor will not revisit it.
      const payload = encodeFundEvent(ev, meta);
      await tx.untrackedFundEvent.upsert({
        where: { id: ev.id },
        create: { id: ev.id, repoId: ev.repoId, payload },
        update: { payload },
      });
      return 'untracked';
    }
    const existing = await tx.bounty.findUnique({ where: { id: ev.id } });
    if (existing) return isStaleEventId(existing.lastEventId, meta.eventId) ? 'stale' : 'anomaly';
    const issueNumber = Number(ev.issue);
    // A submission recorded at /tx/submit binds this exact tx to its intent. Match on it first:
    // two equal-amount intents (e.g. from different maintainers) are interchangeable to the old
    // fuzzy match, which could attribute the bounty to the wrong GitHub user.
    let intent: { id: string; requestedBy: bigint; repoId: bigint; issueNumber: number; amount: { toString(): string }; token: string } | null = null;
    const bound = await tx.fundingSubmission.findUnique({ where: { txHash: meta.txHash }, include: { intent: true } });
    const bindingFits = bound && bound.intent.usedAt === null && bound.intent.repoId === ev.repoId
      && bound.intent.issueNumber === issueNumber && bound.intent.amount.toString() === ev.amount.toString()
      && bound.intent.token === ev.token;
    if (bound && bindingFits) {
      intent = bound.intent;
    } else if (bound) {
      meta.log?.('funding submission does not match the funded event; ignoring binding', { txHash: meta.txHash, intentId: bound.intentId, eventId: meta.eventId });
    }
    if (!intent) {
      // Fallback only (older funding links / direct on-chain funding): ambiguous by design.
      intent = await tx.fundingIntent.findFirst({
        where: { repoId: ev.repoId, issueNumber, usedAt: null, amount: ev.amount.toString(), token: ev.token },
        orderBy: { createdAt: 'desc' },
      });
      if (intent) meta.log?.('funding intent matched fuzzily (no tx binding)', { txHash: meta.txHash, intentId: intent.id, eventId: meta.eventId });
    }
    if (intent) await tx.fundingIntent.update({ where: { id: intent.id }, data: { usedAt: meta.closedAt } });
    await tx.bounty.create({
      data: {
        id: ev.id, repoId: ev.repoId, issueNumber,
        issueTitle: '', issueUrl: issueUrl(repo.fullName, issueNumber),
        criteria: [], maintainer: ev.maintainer, maintainerGithubId: intent?.requestedBy ?? null,
        token: ev.token, amount: ev.amount.toString(), feeBps: ev.feeBps,
        deadline: new Date(Number(ev.deadline) * 1000), relayerAllowed: ev.relayerAllowed,
        status: 'OPEN', fundTx: meta.txHash, createdAt: meta.closedAt, lastEventId: meta.eventId,
      },
    });
    return 'applied';
  }

  const b = await tx.bounty.findUnique({ where: { id: ev.id } });
  if (!b) return 'untracked';
  if (isStaleEventId(b.lastEventId, meta.eventId)) return 'stale';

  const done = { lastEventId: meta.eventId, closeTx: meta.txHash };
  switch (ev.kind) {
    case 'released': {
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'RELEASED', winnerAddress: ev.winner } });
      await tx.payout.updateMany({
        where: { bountyId: b.id, status: { in: ['QUEUED', 'SUBMITTED', 'AWAITING_MAINTAINER'] } },
        data: { status: 'CONFIRMED', txHash: meta.txHash, winnerAddress: ev.winner },
      });
      return 'applied';
    }
    case 'refunded':
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'REFUNDED' } });
      return 'applied';
    case 'disputed':
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { lastEventId: meta.eventId, status: 'DISPUTED' } });
      await tx.dispute.updateMany({ where: { bountyId: b.id, status: DisputeStatus.REQUESTED }, data: { status: DisputeStatus.OPENED_ONCHAIN } });
      return 'applied';
    case 'resolved': {
      if (b.status !== 'DISPUTED') return 'anomaly';
      const proposals = await tx.dispute.findMany({
        where: { bountyId: b.id, pendingWinnerBps: { not: null } },
      });
      const matched = proposals.find((p) => proposalMatches(p, BigInt(b.amount.toString()), ev));
      // the chain is the truth: always apply the resolution, even if the signed split differs from the note
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'RESOLVED', winnerAddress: ev.winner } });
      await tx.dispute.updateMany({ where: { bountyId: b.id, status: { in: [DisputeStatus.REQUESTED, DisputeStatus.OPENED_ONCHAIN] } }, data: { status: DisputeStatus.RESOLVED } });
      if (matched) {
        await tx.dispute.update({
          where: { id: matched.id },
          data: { resolutionNote: matched.pendingNote, pendingWinner: null, pendingWinnerBps: null, pendingNote: null },
        });
        return 'applied';
      }
      const first = proposals[0];
      if (first) {
        await tx.auditLog.create({
          data: {
            actor: 'system', action: 'dispute.resolve.mismatch', target: `dispute:${first.id}`,
            data: {
              winner: ev.winner, winnerNet: ev.winnerNet.toString(), fee: ev.fee.toString(),
              proposals: proposals.map((p) => ({ winner: p.pendingWinner, bps: p.pendingWinnerBps, note: p.pendingNote })),
            },
          },
        });
        return 'anomaly';
      }
      return 'applied';
    }
  }
}
