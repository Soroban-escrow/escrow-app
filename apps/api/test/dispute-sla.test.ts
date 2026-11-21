import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../src/auth/session.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { DISPUTE_REVIEW_HOURS } from '../src/disputes.js';
import { handleIssueComment, type CommandDeps, type IssueCommentPayload } from '../src/github/commands.js';
import { collectAlerts } from '../src/ops/alerts.js';
import { buildServer } from '../src/server.js';

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());
const cfg = loadConfig({
  DATABASE_URL: 'x', BOUNTY_CONTRACT_ID: 'CCEKBPYCWKNTXIQLXJHVAF7RYGUZZ6MITA7VVJBOK5BHXUO44ELZ4F4V',
  SESSION_SECRET: 's'.repeat(32), CSRF_SECRET: 'c'.repeat(32), GITHUB_WEBHOOK_SECRET: 'hooksecret', LOG_LEVEL: 'silent',
});
const HOUR_MS = 3600e3;

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "AuditLog","Payout","Dispute","Bounty","Repo","Installation","Session","User" CASCADE');
  await db.installation.create({ data: { id: 1n, accountLogin: 'o', accountType: 'User' } });
  await db.repo.create({ data: { id: 100n, installationId: 1n, fullName: 'o/r', private: false } });
  await db.bounty.create({ data: {
    id: 1n, repoId: 100n, issueNumber: 7, issueTitle: 'T', issueUrl: '', criteria: [], maintainer: 'GM', maintainerGithubId: 55n,
    token: 'C', amount: '1000', feeBps: 300, deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date(),
  } });
});

describe('dispute review SLA', () => {
  it('is the same constant in the reply, the admin overdue flag and the alerts', async () => {
    // 1. The GitHub reply quotes the shared SLA rather than a hard-coded 48 h.
    const comments: string[] = [];
    const deps: CommandDeps = {
      db,
      gh: { getPermission: async () => 'write', postComment: async (_i, _r, _n, body) => (comments.push(body), 1n) },
      webUrl: 'https://app.test',
      tokens: { USDC: { address: 'C', min: 1n, max: 10n }, XLM: { address: 'X', min: 1n, max: 10n } },
      minDays: 1, maxDays: 90,
    };
    const payload: IssueCommentPayload = {
      installation: { id: 1 }, repository: { id: 100, full_name: 'o/r' }, issue: { number: 7, state: 'open' },
      comment: { id: 1, body: '/bounty dispute not paid', user: { id: 55, login: 'maint', type: 'User' } },
    };
    expect(await handleIssueComment(deps, payload)).toBe('dispute-requested');
    expect(comments[0]).toContain(`within ${DISPUTE_REVIEW_HOURS} hours`);

    // 2. The admin queue flips to overdue at the same threshold.
    await db.dispute.updateMany({ data: { createdAt: new Date(Date.now() - (DISPUTE_REVIEW_HOURS + 1) * HOUR_MS) } });
    const u = await db.user.create({ data: { githubId: 2n, githubLogin: 'admin', isAdmin: true } });
    const cookie = `se_session=${(await createSession(db, u.id)).id}`;
    const chain = {
      buildFundTx: async () => 'x', buildReleaseTx: async () => 'x', buildRefundTx: async () => 'x',
      submitSigned: async () => 'h', getBounty: async () => ({ status: 'Open' }),
      buildOpenDisputeTx: async () => 'x', buildResolveTx: async () => 'x',
    };
    const app = await buildServer(cfg, { insert: async () => true, enqueue: async () => {} }, {
      db, csrfSecret: cfg.CSRF_SECRET, chain,
    });
    const csrf = (await app.inject({ url: '/auth/me', headers: { cookie } })).json().csrfToken as string;
    const headers = { cookie, 'x-csrf-token': csrf };
    const late = (await app.inject({ url: '/admin/disputes', headers })).json();
    expect(late).toHaveLength(1);
    expect(late[0].overdue).toBe(true);
    await db.dispute.updateMany({ data: { createdAt: new Date(Date.now() - (DISPUTE_REVIEW_HOURS - 1) * HOUR_MS) } });
    const fresh = (await app.inject({ url: '/admin/disputes', headers })).json();
    expect(fresh[0].overdue).toBe(false);

    // 3. Ops alerts fire at the same threshold and name it in the message.
    await db.dispute.updateMany({ data: { createdAt: new Date(Date.now() - (DISPUTE_REVIEW_HOURS + 1) * HOUR_MS) } });
    const alerts = await collectAlerts({ db, now: () => new Date(), minRelayerXlm: 50 });
    expect(alerts.join('|')).toContain(`1 dispute(s) older than ${DISPUTE_REVIEW_HOURS} h`);
  });
});
