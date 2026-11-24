import { PullRequestState, type Prisma } from '@prisma/client';
import type { Db } from '../db.js';
import { issueUrlPrefix } from '../github/issue-url.js';
import { parseCriteria, criteriaChanged, formatCriteriaChangeComment, CRITERIA_CHANGED_ACTION } from '../github/criteria.js';
import { replayUntrackedFunds } from '../indexer/replay.js';
import { handleIssueComment, type CommandDeps, type IssueCommentPayload } from '../github/commands.js';
import { handlePullRequest, type PullDeps, type PullRequestPayload } from '../github/pulls.js';
import type { Notifier } from '../payouts/ports.js';

export interface DispatchDeps {
  db: Db;
  commands: CommandDeps;
  pulls: PullDeps;
  notifier?: Notifier;
  /** Re-renders a bounty's GitHub card after the issue changes (wired in worker/main.ts). */
  refreshCard: (bountyId: bigint) => Promise<unknown>;
  log?: (msg: string, extra?: unknown) => void;
}

interface InstallationPayload {
  action: string;
  installation: { id: number; account: { login: string; type: string }; suspended_at?: string | null };
  repositories?: { id: number; full_name: string; private: boolean }[];
  repositories_added?: { id: number; full_name: string; private: boolean }[];
  repositories_removed?: { id: number }[];
}
interface RepositoryPayload {
  action: string;
  repository: { id: number; full_name: string };
}
interface IssuesPayload {
  action: string;
  repository: { id: number };
  issue: { number: number; title: string; body: string | null };
  sender?: { id: number; login?: string };
}

async function upsertRepos(db: Db, installationId: bigint, repos: { id: number; full_name: string; private: boolean }[] = []) {
  for (const r of repos) {
    await db.repo.upsert({
      where: { id: BigInt(r.id) },
      create: { id: BigInt(r.id), installationId, fullName: r.full_name, private: r.private, active: true },
      update: { installationId, fullName: r.full_name, private: r.private, active: true },
    });
    // A bounty may have been funded before the app was installed on this repo.
    await replayUntrackedFunds(db, BigInt(r.id));
  }
}

/** A rename keeps the repo id, so every stored issue URL and every GitHub API call must be re-based. */
async function renameRepo(d: DispatchDeps, p: RepositoryPayload): Promise<string> {
  if (p.action !== 'renamed' && p.action !== 'transferred') return 'ignored';
  const id = BigInt(p.repository.id);
  const r = await d.db.repo.updateMany({ where: { id }, data: { fullName: p.repository.full_name } });
  if (!r.count) return `repository.${p.action}:untracked`;
  await d.db.$executeRaw`UPDATE "Bounty" SET "issueUrl" = ${issueUrlPrefix(p.repository.full_name)} || "issueNumber"::text WHERE "repoId" = ${id}`;
  return `repository.${p.action}:${r.count}`;
}

/** Routes one verified webhook delivery to its handler. Unknown events are ignored, not errors. */
export async function dispatchWebhook(d: DispatchDeps, event: string, payload: unknown): Promise<string> {
  switch (event) {
    case 'installation': {
      const p = payload as InstallationPayload;
      const id = BigInt(p.installation.id);
      if (p.action === 'created' || p.action === 'unsuspend' || p.action === 'new_permissions_accepted') {
        await d.db.installation.upsert({
          where: { id }, create: { id, accountLogin: p.installation.account.login, accountType: p.installation.account.type },
          update: { accountLogin: p.installation.account.login, suspendedAt: null },
        });
        await upsertRepos(d.db, id, p.repositories);
      } else if (p.action === 'suspend') {
        await d.db.installation.updateMany({ where: { id }, data: { suspendedAt: new Date() } });
      } else if (p.action === 'deleted') {
        // keep rows that bounties point at; only mark the installation suspended
        await d.db.installation.updateMany({ where: { id }, data: { suspendedAt: new Date() } });
      }
      return `installation.${p.action}`;
    }
    case 'installation_repositories': {
      const p = payload as InstallationPayload;
      const id = BigInt(p.installation.id);
      await d.db.installation.upsert({ where: { id }, create: { id, accountLogin: p.installation.account.login, accountType: p.installation.account.type }, update: {} });
      await upsertRepos(d.db, id, p.repositories_added);
      const removed = (p.repositories_removed ?? []).map((r) => BigInt(r.id));
      if (removed.length) {
        // scoped to this installation: a repo transferred to another account is re-added by its new one
        await d.db.repo.updateMany({ where: { id: { in: removed }, installationId: id }, data: { active: false } });
      }
      return `installation_repositories.${p.action}:+${p.repositories_added?.length ?? 0}/-${removed.length}`;
    }
    case 'repository':
      return renameRepo(d, payload as RepositoryPayload);
    case 'issue_comment': {
      const p = payload as IssueCommentPayload & { action: string };
      if (p.action !== 'created') return 'ignored';
      return handleIssueComment(d.commands, p);
    }
    case 'pull_request': {
      const p = payload as PullRequestPayload;
      return `pull_request:${(await handlePullRequest(d.pulls, p)).length}`;
    }
    case 'issues': {
      const p = payload as IssuesPayload;
      if (p.action !== 'edited') return 'ignored';
      const where: Prisma.BountyWhereInput = { repoId: BigInt(p.repository.id), issueNumber: p.issue.number, status: { in: ['OPEN', 'DISPUTED'] } };
      const affected = await d.db.bounty.findMany({ where, select: { id: true, criteria: true, status: true } });
      if (affected.length) {
        const newCriteria = parseCriteria(p.issue.body);
        const notifier = d.notifier ?? d.pulls?.notifier;

        for (const b of affected) {
          if (b.status === 'OPEN' && criteriaChanged(b.criteria, newCriteria)) {
            await d.db.auditLog.create({
              data: {
                actor: p.sender?.id ? `github:${p.sender.id}` : 'system',
                action: CRITERIA_CHANGED_ACTION,
                target: `bounty:${b.id}`,
                data: {
                  old: b.criteria,
                  new: newCriteria,
                  oldCriteria: b.criteria,
                  newCriteria,
                },
              },
            });

            if (notifier) {
              const openPrs = await d.db.pullRequest.findMany({
                where: {
                  state: PullRequestState.OPEN,
                  bounties: { some: { bountyId: b.id } },
                },
                select: { number: true },
              });
              const comment = formatCriteriaChangeComment(b.criteria, newCriteria);
              for (const pr of openPrs) {
                try {
                  await notifier.notify(b.id, pr.number, comment);
                } catch (e) {
                  d.log?.('criteria change notification failed', {
                    bountyId: String(b.id),
                    prNumber: pr.number,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }
            }
          }
        }

        await d.db.bounty.updateMany({
          where: { id: { in: affected.map((b) => b.id) } },
          data: { issueTitle: p.issue.title, criteria: newCriteria },
        });
        // The DB now has the new title/criteria; push them to the card immediately instead of
        // waiting for the next chain event. A failure on one bounty must not block the others.
        for (const b of affected) {
          try { await d.refreshCard(b.id); }
          catch (e) { d.log?.('card refresh after issue edit failed', { bountyId: String(b.id), error: e instanceof Error ? e.message : String(e) }); }
        }
      }
      return `issues.edited:${affected.length}`;
    }
    default:
      return 'ignored';
  }
}
