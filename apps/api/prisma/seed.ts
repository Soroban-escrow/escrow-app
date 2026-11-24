import { BountyStatus, DisputeStatus, PullRequestState, PayoutStatus, type PrismaClient } from '@prisma/client';
import { createDb } from '../src/db.js';
import { loadDotEnv } from '../src/config.js';

export async function seedDemoData(db: PrismaClient): Promise<void> {
  const now = new Date();
  const futureDeadline = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const pastDeadline = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const demoToken = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
  const maintainerAddr = 'GBMAINTAINERDEMOADDR000000000000000000000000000000000001';
  const winnerAddr = 'GBWINNERDEMOADDR0000000000000000000000000000000000000002';

  await db.installation.upsert({
    where: { id: 1001n },
    update: { accountLogin: 'soroban-escrow-demo', accountType: 'Organization' },
    create: { id: 1001n, accountLogin: 'soroban-escrow-demo', accountType: 'Organization' },
  });

  await db.repo.upsert({
    where: { id: 2001n },
    update: { fullName: 'soroban-escrow-demo/demo-repo', private: false },
    create: {
      id: 2001n,
      installationId: 1001n,
      fullName: 'soroban-escrow-demo/demo-repo',
      private: false,
    },
  });

  const bountyDefs: Array<{
    id: bigint;
    issueNumber: number;
    issueTitle: string;
    status: BountyStatus;
    amount: string;
    deadline: Date;
    winnerAddress: string | null;
    winnerGithubId: bigint | null;
    closeTx: string | null;
  }> = [
    {
      id: 1n,
      issueNumber: 101,
      issueTitle: 'Add webhook signature verification',
      status: BountyStatus.OPEN,
      amount: '500000000',
      deadline: futureDeadline,
      winnerAddress: null,
      winnerGithubId: null,
      closeTx: null,
    },
    {
      id: 2n,
      issueNumber: 102,
      issueTitle: 'Implement USDC payout relayer',
      status: BountyStatus.RELEASED,
      amount: '1000000000',
      deadline: futureDeadline,
      winnerAddress: winnerAddr,
      winnerGithubId: 5002n,
      closeTx: 'tx-close-release-2',
    },
    {
      id: 3n,
      issueNumber: 103,
      issueTitle: 'Expired documentation bounty',
      status: BountyStatus.REFUNDED,
      amount: '250000000',
      deadline: pastDeadline,
      winnerAddress: null,
      winnerGithubId: null,
      closeTx: 'tx-close-refund-3',
    },
    {
      id: 4n,
      issueNumber: 104,
      issueTitle: 'Disputed indexer cursor fix',
      status: BountyStatus.DISPUTED,
      amount: '750000000',
      deadline: futureDeadline,
      winnerAddress: winnerAddr,
      winnerGithubId: 5002n,
      closeTx: null,
    },
    {
      id: 5n,
      issueNumber: 105,
      issueTitle: 'Resolved split-payout bounty',
      status: BountyStatus.RESOLVED,
      amount: '600000000',
      deadline: pastDeadline,
      winnerAddress: winnerAddr,
      winnerGithubId: 5002n,
      closeTx: 'tx-close-resolve-5',
    },
  ];

  for (const b of bountyDefs) {
    await db.bounty.upsert({
      where: { id: b.id },
      update: {
        status: b.status,
        winnerAddress: b.winnerAddress,
        winnerGithubId: b.winnerGithubId,
        closeTx: b.closeTx,
      },
      create: {
        id: b.id,
        repoId: 2001n,
        issueNumber: b.issueNumber,
        issueTitle: b.issueTitle,
        issueUrl: `https://github.com/soroban-escrow-demo/demo-repo/issues/${b.issueNumber}`,
        criteria: ['Unit tests pass', 'Typecheck clean'],
        maintainer: maintainerAddr,
        maintainerGithubId: 5001n,
        token: demoToken,
        amount: b.amount,
        feeBps: 300,
        deadline: b.deadline,
        relayerAllowed: true,
        status: b.status,
        winnerAddress: b.winnerAddress,
        winnerGithubId: b.winnerGithubId,
        fundTx: `tx-fund-${b.id.toString()}`,
        closeTx: b.closeTx,
        createdAt: now,
      },
    });
  }

  const prs: Array<{
    id: bigint; number: number; authorGithubId: bigint; authorLogin: string; headSha: string;
    state: PullRequestState; mergedAt: Date | null; bountyId: bigint; verdict: string; score: number;
  }> = [
    {
      id: 3001n,
      number: 11,
      authorGithubId: 5002n,
      authorLogin: 'alice-dev',
      headSha: 'abc1111',
      state: PullRequestState.OPEN,
      mergedAt: null,
      bountyId: 1n,
      verdict: 'STRONG',
      score: 92,
    },
    {
      id: 3002n,
      number: 12,
      authorGithubId: 5003n,
      authorLogin: 'bob-dev',
      headSha: 'def2222',
      state: PullRequestState.CLOSED,
      mergedAt: now,
      bountyId: 2n,
      verdict: 'STRONG',
      score: 96,
    },
  ];

  for (const pr of prs) {
    await db.pullRequest.upsert({
      where: { id: pr.id },
      update: { state: pr.state, mergedAt: pr.mergedAt },
      create: {
        id: pr.id,
        number: pr.number,
        authorGithubId: pr.authorGithubId,
        authorLogin: pr.authorLogin,
        headSha: pr.headSha,
        state: pr.state,
        mergedAt: pr.mergedAt,
        diffHash: `hash-${pr.headSha}`,
      },
    });

    await db.pullRequestBounty.upsert({
      where: { prId_bountyId: { prId: pr.id, bountyId: pr.bountyId } },
      update: {},
      create: { prId: pr.id, bountyId: pr.bountyId },
    });

    await db.aiReview.upsert({
      where: { prId_headSha: { prId: pr.id, headSha: pr.headSha } },
      update: { verdict: pr.verdict, score: pr.score },
      create: {
        prId: pr.id,
        headSha: pr.headSha,
        model: 'claude-sonnet-5-5',
        verdict: pr.verdict,
        score: pr.score,
        result: { summary: `Automated demo review for PR #${pr.number}`, checks: ['tests', 'types'] },
        flags: [],
        inputTokens: 1200,
        outputTokens: 350,
      },
    });
  }

  const payoutDefs: Array<{
    idempotencyKey: string;
    bountyId: bigint;
    prNumber: number;
    status: PayoutStatus;
    txHash: string | null;
    lastError: string | null;
  }> = [
    { idempotencyKey: 'seed-payout-confirmed', bountyId: 2n, prNumber: 12, status: PayoutStatus.CONFIRMED, txHash: 'tx-payout-confirmed', lastError: null },
    { idempotencyKey: 'seed-payout-queued', bountyId: 1n, prNumber: 11, status: PayoutStatus.QUEUED, txHash: null, lastError: null },
    { idempotencyKey: 'seed-payout-pending-wallet', bountyId: 4n, prNumber: 14, status: PayoutStatus.PENDING_WALLET, txHash: null, lastError: null },
    { idempotencyKey: 'seed-payout-failed', bountyId: 5n, prNumber: 15, status: PayoutStatus.FAILED, txHash: null, lastError: 'Simulated RPC timeout' },
  ];

  for (const p of payoutDefs) {
    await db.payout.upsert({
      where: { idempotencyKey: p.idempotencyKey },
      update: { status: p.status, txHash: p.txHash, lastError: p.lastError },
      create: {
        bountyId: p.bountyId,
        prNumber: p.prNumber,
        winnerGithubId: 5002n,
        winnerAddress: p.status === PayoutStatus.PENDING_WALLET ? null : winnerAddr,
        status: p.status,
        idempotencyKey: p.idempotencyKey,
        txHash: p.txHash,
        attempts: p.status === PayoutStatus.FAILED ? 2 : 1,
        lastError: p.lastError,
      },
    });
  }

  await db.dispute.upsert({
    where: { id: 'seed-dispute-4' },
    update: { status: DisputeStatus.REQUESTED },
    create: {
      id: 'seed-dispute-4',
      bountyId: 4n,
      openedByGithubId: 5002n,
      reason: 'Acceptance criteria were met before deadline; requesting arbiter review.',
      evidence: { prUrl: 'https://github.com/soroban-escrow-demo/demo-repo/pull/14' },
      status: DisputeStatus.REQUESTED,
    },
  });
}

async function main() {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set to run prisma/seed.ts');
  }
  const db = createDb(databaseUrl);
  try {
    await seedDemoData(db);
    console.log('Seeded local demo data (installations, repos, bounties, PRs, reviews, payouts, dispute).');
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
