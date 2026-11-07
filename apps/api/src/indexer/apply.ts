import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ChainEvent } from './decode.js';

export interface EventMeta {
  eventId: string;
  txHash: string;
  closedAt: Date;
}

export type Outcome = 'applied' | 'stale' | 'untracked' | 'anomaly';

export interface RevalidateNotifierOptions {
  webUrl?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  nowSec?: number;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Signs and posts a cache-tag purge request (`POST /api/revalidate`) to the Next.js web app
 * whenever a bounty's status changes on-chain. No-op when `REVALIDATE_SECRET` is not configured.
 */
export async function notifyBountyRevalidate(
  bountyId: bigint | string,
  opts?: RevalidateNotifierOptions,
): Promise<boolean> {
  const secret = opts?.secret ?? process.env.REVALIDATE_SECRET;
  if (!secret) return false;

  const webUrl = (opts?.webUrl ?? process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const fetcher = opts?.fetchImpl ?? fetch;
  const ts = String(opts?.nowSec ?? Math.floor(Date.now() / 1000));
  const idStr = String(bountyId);
  const rawBody = JSON.stringify({
    bountyId: idStr,
    tags: ['bounties', `bounty:${idStr}`],
  });
  const sig = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;

  try {
    const res = await fetcher(`${webUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-timestamp': ts,
        'x-revalidate-signature': sig,
      },
      body: rawBody,
    });
    if (!res.ok) {
      opts?.log?.('revalidate webhook returned non-2xx', { bountyId: idStr, status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    opts?.log?.('revalidate webhook failed', { bountyId: idStr, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * Applies one event inside the caller's transaction. Idempotent: every bounty records the last
 * event applied, so replaying an old event is recognised as stale instead of re-applied.
 * Returns what happened so the caller can enqueue follow-up jobs only for 'applied'.
 */
export async function applyEvent(
  tx: Prisma.TransactionClient,
  ev: ChainEvent,
  meta: EventMeta,
  revalidateOpts?: RevalidateNotifierOptions,
): Promise<Outcome> {
  if (ev.kind === 'funded') {
    const repo = await tx.repo.findUnique({ where: { id: ev.repoId } });
    if (!repo) return 'untracked'; // anyone can fund any repo on-chain; we only track installed ones
    const existing = await tx.bounty.findUnique({ where: { id: ev.id } });
    if (existing) return existing.lastEventId && existing.lastEventId >= meta.eventId ? 'stale' : 'anomaly';
    const issueNumber = Number(ev.issue);
    const intent = await tx.fundingIntent.findFirst({
      where: { repoId: ev.repoId, issueNumber, usedAt: null, amount: ev.amount.toString(), token: ev.token },
      orderBy: { createdAt: 'desc' },
    });
    if (intent) await tx.fundingIntent.update({ where: { id: intent.id }, data: { usedAt: meta.closedAt } });
    await tx.bounty.create({
      data: {
        id: ev.id, repoId: ev.repoId, issueNumber,
        issueTitle: '', issueUrl: `https://github.com/${repo.fullName}/issues/${issueNumber}`,
        criteria: [], maintainer: ev.maintainer, maintainerGithubId: intent?.requestedBy ?? null,
        token: ev.token, amount: ev.amount.toString(), feeBps: ev.feeBps,
        deadline: new Date(Number(ev.deadline) * 1000), relayerAllowed: ev.relayerAllowed,
        status: 'OPEN', fundTx: meta.txHash, createdAt: meta.closedAt, lastEventId: meta.eventId,
      },
    });
    void notifyBountyRevalidate(ev.id, revalidateOpts);
    return 'applied';
  }

  const b = await tx.bounty.findUnique({ where: { id: ev.id } });
  if (!b) return 'untracked';
  if (b.lastEventId && b.lastEventId >= meta.eventId) return 'stale';

  const done = { lastEventId: meta.eventId, closeTx: meta.txHash };
  switch (ev.kind) {
    case 'released': {
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'RELEASED', winnerAddress: ev.winner } });
      await tx.payout.updateMany({
        where: { bountyId: b.id, status: { in: ['QUEUED', 'SUBMITTED', 'AWAITING_MAINTAINER'] } },
        data: { status: 'CONFIRMED', txHash: meta.txHash, winnerAddress: ev.winner },
      });
      void notifyBountyRevalidate(b.id, revalidateOpts);
      return 'applied';
    }
    case 'refunded':
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'REFUNDED' } });
      void notifyBountyRevalidate(b.id, revalidateOpts);
      return 'applied';
    case 'disputed':
      if (b.status !== 'OPEN') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { lastEventId: meta.eventId, status: 'DISPUTED' } });
      await tx.dispute.updateMany({ where: { bountyId: b.id, status: 'requested' }, data: { status: 'opened_onchain' } });
      void notifyBountyRevalidate(b.id, revalidateOpts);
      return 'applied';
    case 'resolved':
      if (b.status !== 'DISPUTED') return 'anomaly';
      await tx.bounty.update({ where: { id: b.id }, data: { ...done, status: 'RESOLVED', winnerAddress: ev.winner } });
      await tx.dispute.updateMany({ where: { bountyId: b.id, status: { in: ['requested', 'opened_onchain'] } }, data: { status: 'resolved' } });
      void notifyBountyRevalidate(b.id, revalidateOpts);
      return 'applied';
  }
}
