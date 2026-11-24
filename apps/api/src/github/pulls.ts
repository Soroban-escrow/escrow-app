import { PullRequestState } from '@prisma/client';
import type { Db } from '../db.js';
import { onMerge, type PayoutDeps } from '../payouts/payout.js';

const KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi;

/** Issue numbers a PR body closes in the given repo (GitHub closing keywords; cross-repo refs ignored). */
export function parseClosingRefs(body: string | null | undefined, repoFullName: string): number[] {
  const out = new Set<number>();
  for (const m of (body ?? '').matchAll(KEYWORD)) {
    if (m[1] && m[1].toLowerCase() !== repoFullName.toLowerCase()) continue;
    out.add(Number(m[2]));
  }
  return [...out].sort((a, b) => a - b);
}

export interface PullRequestPayload {
  action: string;
  repository: { id: number; full_name: string; default_branch: string; owner?: { id: number } };
  pull_request: {
    id: number; number: number; body: string | null; draft?: boolean; merged: boolean; merged_at: string | null;
    state: string; head: { sha: string }; base: { ref: string }; user: { id: number; login: string; type: string };
  };
}

export type PullDeps = PayoutDeps & { db: Db; reviewTrigger?: (prId: bigint) => void };

/** Tracks PRs against active bounties and triggers payouts on merge. Returns bounty ids touched. */
export async function handlePullRequest(d: PullDeps, p: PullRequestPayload): Promise<bigint[]> {
  const pr = p.pull_request;
  if (pr.user.type === 'Bot') return [];
  const prId = BigInt(pr.id);
  const existing = await d.db.pullRequest.findUnique({ where: { id: prId } });
  if (existing?.state === PullRequestState.MERGED) return []; // once merged, the record and its links are frozen

  const repoId = BigInt(p.repository.id);
  const issues = parseClosingRefs(pr.body, p.repository.full_name);

  // The body is the source of truth for which bounties the PR closes. On edit-like actions
  // (while the PR is still open) drop links to bounties it no longer references, so a PR
  // that removes a closing keyword cannot pay out that bounty when it is merged later.
  if (!pr.merged && ['edited', 'opened', 'synchronize'].includes(p.action)) {
    const links = await d.db.pullRequestBounty.findMany({ where: { prId }, select: { bountyId: true } });
    if (links.length > 0) {
      const linked = await d.db.bounty.findMany({
        where: { id: { in: links.map((l) => l.bountyId) } },
        select: { id: true, repoId: true, issueNumber: true },
      });
      const stale = linked.filter((b) => b.repoId !== repoId || !issues.includes(b.issueNumber)).map((b) => b.id);
      if (stale.length > 0) await d.db.pullRequestBounty.deleteMany({ where: { prId, bountyId: { in: stale } } });
    }
  }

  if (issues.length === 0) return [];
  const bounties = await d.db.bounty.findMany({
    where: { repoId, issueNumber: { in: issues }, status: { in: ['OPEN', 'DISPUTED'] } },
  });
  // the maintainer's own PRs never earn the bounty (also blocked on-chain)
  const eligible = bounties.filter((b) => b.maintainerGithubId !== BigInt(pr.user.id));
  if (eligible.length === 0) return [];
  const data = {
    number: pr.number, authorGithubId: BigInt(pr.user.id), authorLogin: pr.user.login,
    headSha: pr.head.sha, state: pr.merged ? PullRequestState.MERGED : pr.state === 'closed' ? PullRequestState.CLOSED : PullRequestState.OPEN,
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
  };
  await d.db.pullRequest.upsert({ where: { id: prId }, create: { id: prId, ...data }, update: data });
  // one PR can close several bountied issues: one link per (PR, bounty)
  for (const b of eligible) {
    await d.db.pullRequestBounty.upsert({ where: { prId_bountyId: { prId, bountyId: b.id } }, create: { prId, bountyId: b.id }, update: {} });
  }
  // Only a merge into the repository's default branch fixes the issue. GitHub closes
  // issues only for the default branch, and a feature-branch merge must not pay out.
  const intoDefaultBranch = Boolean(p.repository.default_branch && pr.base?.ref === p.repository.default_branch);
  if (pr.merged && p.action === 'closed' && intoDefaultBranch) {
    for (const b of eligible) await onMerge(d, { bountyId: b.id, prNumber: pr.number, authorGithubId: BigInt(pr.user.id) });
  }
  if (!pr.merged && ['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(p.action) && !pr.draft) d.reviewTrigger?.(prId);
  return eligible.map((b) => b.id);
}
