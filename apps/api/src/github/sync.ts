import type { Db } from '../db.js';
import { fromBaseUnits, net } from '@skillescrow/shared';
import { labelFor, renderCard } from './card.js';
import { parseCriteria } from './criteria.js';
import type { Notifier } from '../payouts/ports.js';
import type { IssueCommenter } from '../ops/reminders.js';

/** The slice of the GitHub client the sync code needs (tests pass a fake). */
export interface GithubApi {
  getIssue(installation: bigint, repo: string, issue: number): Promise<{ title: string; body: string | null; html_url: string }>;
  postComment(installation: bigint, repo: string, issue: number, body: string): Promise<bigint>;
  updateComment(installation: bigint, repo: string, commentId: bigint, body: string): Promise<void>;
  setBountyLabel(installation: bigint, repo: string, issue: number, label: string): Promise<void>;
}

export interface SyncDeps {
  db: Db;
  gh: GithubApi;
  webUrl: string;
  /** token contract id -> symbol, e.g. USDC */
  symbolFor: (token: string) => string;
  log?: (msg: string, extra?: unknown) => void;
}

const STATUS_LABEL = { OPEN: true, RELEASED: false, REFUNDED: false, DISPUTED: true, RESOLVED: false } as const;

/**
 * Brings the bounty's GitHub presence in line with its state: fills the issue title and criteria,
 * posts the card once and edits it in place afterwards, and keeps the bounty label current.
 * Safe to call repeatedly (every chain event for the bounty calls it).
 */
export async function refreshBountyCard(d: SyncDeps, bountyId: bigint): Promise<'posted' | 'updated' | 'skipped'> {
  const b = await d.db.bounty.findUnique({ where: { id: bountyId }, include: { repo: true } });
  if (!b) return 'skipped';
  const installation = b.repo.installationId;
  const repo = b.repo.fullName;

  // the indexer only knows what the chain says; the title and criteria come from the issue
  let title = b.issueTitle, criteria = b.criteria;
  try {
    const issue = await d.gh.getIssue(installation, repo, b.issueNumber);
    title = issue.title;
    criteria = parseCriteria(issue.body);
    if (title !== b.issueTitle || criteria.join('\n') !== b.criteria.join('\n')) {
      await d.db.bounty.update({ where: { id: b.id }, data: { issueTitle: title, criteria } });
    }
  } catch (e) { d.log?.('issue fetch failed; rendering with stored data', e instanceof Error ? e.message : String(e)); }

  const symbol = d.symbolFor(b.token);
  const body = renderCard({
    id: b.id, status: b.status, amount: BigInt(b.amount.toString()), symbol, deadline: b.deadline,
    relayerAllowed: b.relayerAllowed, criteria, issueNumber: b.issueNumber, webUrl: d.webUrl,
  });

  // One refresh at a time per bounty: without the lock two concurrent calls would both post a card.
  const outcome = await d.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${b.id})`;
    const fresh = await tx.bounty.findUniqueOrThrow({ where: { id: b.id }, select: { cardCommentId: true } });
    if (fresh.cardCommentId) {
      await d.gh.updateComment(installation, repo, fresh.cardCommentId, body);
      return 'updated' as const;
    }
    const id = await d.gh.postComment(installation, repo, b.issueNumber, body);
    await tx.bounty.update({ where: { id: b.id }, data: { cardCommentId: id } });
    return 'posted' as const;
  }, { timeout: 20_000 });
  if (STATUS_LABEL[b.status]) await d.gh.setBountyLabel(installation, repo, b.issueNumber, labelFor(BigInt(b.amount.toString()), symbol));
  return outcome;
}

/** Comments for the payout flow: on the PR when there is one, otherwise on the bounty's issue. */
export function githubNotifier(d: Pick<SyncDeps, 'db' | 'gh'>): Notifier {
  return {
    async notify(bountyId, prNumber, message) {
      const b = await d.db.bounty.findUnique({ where: { id: bountyId }, include: { repo: true } });
      if (!b) return;
      await d.gh.postComment(b.repo.installationId, b.repo.fullName, prNumber > 0 ? prNumber : b.issueNumber, message);
    },
  };
}

export function githubIssueCommenter(d: Pick<SyncDeps, 'db' | 'gh'>): IssueCommenter {
  return {
    async comment(bountyId, body) {
      const b = await d.db.bounty.findUnique({ where: { id: bountyId }, include: { repo: true } });
      if (b) await d.gh.postComment(b.repo.installationId, b.repo.fullName, b.issueNumber, body);
    },
  };
}

export const REJECT_NOTIFIED_ACTION = 'dispute.rejected.notified';

/** The "A human will review this…" follow-up, addressed to whoever opened the dispute. */
export async function rejectionCommentBody(
  db: Db,
  dispute: { openedByGithubId: bigint; openedByLogin: string | null; resolutionNote: string | null },
): Promise<string> {
  const login = dispute.openedByLogin
    ?? (await db.user.findUnique({ where: { githubId: dispute.openedByGithubId }, select: { githubLogin: true } }))?.githubLogin;
  const who = login ? `@${login}` : 'the reporter';
  return `${who}, thanks for flagging this. An admin has reviewed your dispute and rejected it.\n\n> ${dispute.resolutionNote ?? ''}`;
}

export interface RejectionNotifyDeps {
  db: Db;
  commenter: IssueCommenter;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Posts the rejection outcome to the bounty issue. The success audit row makes this idempotent and
 * tells the retry sweep when to stop. A GitHub failure is logged, never propagated to the caller:
 * the rejection itself is already committed.
 */
export async function notifyDisputeRejected(d: RejectionNotifyDeps, disputeId: string): Promise<'sent' | 'failed' | 'skipped'> {
  const dispute = await d.db.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute || dispute.status !== 'rejected') return 'skipped';
  const target = `dispute:${dispute.id}`;
  if (await d.db.auditLog.findFirst({ where: { action: REJECT_NOTIFIED_ACTION, target } })) return 'skipped';
  const body = await rejectionCommentBody(d.db, dispute);
  try {
    await d.commenter.comment(dispute.bountyId, body);
    await d.db.auditLog.create({ data: { actor: 'system', action: REJECT_NOTIFIED_ACTION, target, data: { body } } });
    return 'sent';
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    d.log?.('dispute rejection comment failed; will retry', { dispute: disputeId, error });
    await d.db.auditLog.create({ data: { actor: 'system', action: 'dispute.rejected.notify_failed', target, data: { error, body } } });
    return 'failed';
  }
}

/** Re-attempts rejections whose follow-up never reached GitHub. Driven by the worker's timer. */
export async function retryPendingRejectComments(d: RejectionNotifyDeps): Promise<string[]> {
  const rejected = await d.db.dispute.findMany({ where: { status: 'rejected' }, select: { id: true } });
  const sent = await d.db.auditLog.findMany({ where: { action: REJECT_NOTIFIED_ACTION }, select: { target: true } });
  const done = new Set(sent.map((s) => s.target));
  const retried: string[] = [];
  for (const r of rejected) {
    if (done.has(`dispute:${r.id}`)) continue;
    if (await notifyDisputeRejected(d, r.id) === 'sent') retried.push(r.id);
  }
  return retried;
}

/** "50.00 USDC" style text for paid comments. */
export const formatPaid = (amount: bigint, feeBps: number, symbol: string) => {
  const net = amount - (amount * BigInt(feeBps)) / 10_000n;
  return `${fromBaseUnits(net, 7, 2)} ${symbol}`;
};

/**
 * "Paid 4.85 XLM to @login (tx)" on the PR, once per bounty. Covers every release path (relayer or the
 * maintainer signing). Marked in the audit log so a replayed event never comments twice.
 */
export async function announcePayout(d: SyncDeps & { explorerTx: (hash: string) => string }, bountyId: bigint): Promise<'announced' | 'skipped'> {
  const b = await d.db.bounty.findUnique({ where: { id: bountyId }, include: { repo: true, prs: { include: { pr: true } } } });
  if (!b || b.status !== 'RELEASED' || !b.closeTx || !b.winnerAddress) return 'skipped';
  const target = `bounty:${b.id}`;
  if (await d.db.auditLog.findFirst({ where: { action: 'payout.announced', target } })) return 'skipped';

  const payout = await d.db.payout.findUnique({ where: { idempotencyKey: `release:${b.id}` } });
  const link = payout ? b.prs.find((l) => l.pr.number === payout.prNumber) : undefined;
  const who = link ? `@${link.pr.authorLogin}` : `\`${b.winnerAddress.slice(0, 6)}…${b.winnerAddress.slice(-4)}\``;
  const amount = `${fromBaseUnits(net(BigInt(b.amount.toString()), b.feeBps), 7, 2)} ${d.symbolFor(b.token)}`;
  const body = `**Paid ${amount} to ${who}.** [Transaction ${b.closeTx.slice(0, 8)}…](${d.explorerTx(b.closeTx)})`;
  await d.gh.postComment(b.repo.installationId, b.repo.fullName, payout?.prNumber ?? b.issueNumber, body);
  await d.db.auditLog.create({ data: { actor: 'system', action: 'payout.announced', target, data: { tx: b.closeTx } } });
  return 'announced';
}
