import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { applyEvent } from '../src/indexer/apply.js';
import type { ChainEvent } from '../src/indexer/decode.js';
import { dispatchWebhook, type DispatchDeps } from '../src/worker/dispatch.js';
import { webhookProducer, webhookWorker, type WebhookJob } from '../src/worker/queue.js';

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

let comments: string[];
let cardUpdates: string[];
let notifications: { bountyId: bigint; prNumber: number; message: string }[];
// Fake GitHub API for card refreshes. getIssue fails on purpose: the refreshed card must be
// rendered from the criteria the issues.edited handler just wrote to the DB.
const gh: GithubApi = {
  getIssue: async () => { throw new Error('issue fetch unavailable'); },
  postComment: async () => 555n,
  updateComment: async (_i, _r, _id, body) => void cardUpdates.push(body),
  setBountyLabel: async () => {},
};
const deps = (): DispatchDeps => ({
  db,
  commands: {
    db, webUrl: 'https://app.test', minDays: 1, maxDays: 90,
    tokens: { USDC: { address: 'CUSDC', min: 10_000_000n, max: 5_000_000_000n }, XLM: { address: 'CXLM', min: 1n, max: 9n } },
    gh: { getPermission: async () => 'write', postComment: async (_i, _r, _n, b) => (comments.push(b), 1n) },
  },
  pulls: {
    db,
    webUrl: 'https://app.test',
    chain: { getBounty: async () => ({ status: 'Open', relayerAllowed: true, maintainer: 'GM' }) },
    notifier: { notify: async (b, pr, m) => { notifications.push({ bountyId: b, prNumber: pr, message: m }); } },
  },
  notifier: { notify: async (b, pr, m) => { notifications.push({ bountyId: b, prNumber: pr, message: m }); } },
  refreshCard: async (bountyId) => { await refreshBountyCard({ db, gh, webUrl: 'https://app.test', symbolFor: () => 'USDC' }, bountyId); },
});

beforeEach(async () => {
  comments = [];
  cardUpdates = [];
  notifications = [];
  await db.$executeRawUnsafe('TRUNCATE "AuditLog","Payout","PullRequestBounty","PullRequest","Bounty","FundingIntent","UntrackedFundEvent","Repo","Installation" CASCADE');
});

const install = { action: 'created', installation: { id: 9, account: { login: 'o', type: 'Organization' } }, repositories: [{ id: 100, full_name: 'o/r', private: false }] };

describe('dispatchWebhook', () => {
  it('records installations and repos; repositories_added adds more; suspend/delete mark the installation', async () => {
    expect(await dispatchWebhook(deps(), 'installation', install)).toBe('installation.created');
    expect((await db.repo.findUniqueOrThrow({ where: { id: 100n } })).fullName).toBe('o/r');
    await dispatchWebhook(deps(), 'installation_repositories', { action: 'added', installation: install.installation, repositories_added: [{ id: 101, full_name: 'o/r2', private: true }] });
    expect(await db.repo.count()).toBe(2);
    await dispatchWebhook(deps(), 'installation', { ...install, action: 'suspend' });
    expect((await db.installation.findUniqueOrThrow({ where: { id: 9n } })).suspendedAt).not.toBeNull();
    await dispatchWebhook(deps(), 'installation', { ...install, action: 'unsuspend' });
    expect((await db.installation.findUniqueOrThrow({ where: { id: 9n } })).suspendedAt).toBeNull();
  });
  it('renames a repo and re-bases the issue URLs of its bounties', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({ data: { id: 1n, repoId: 100n, issueNumber: 7, issueTitle: '', issueUrl: 'https://github.com/o/r/issues/7', criteria: [], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300, deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date() } });
    expect(await dispatchWebhook(deps(), 'repository', { action: 'renamed', repository: { id: 100, full_name: 'o/renamed' } })).toBe('repository.renamed:1');
    expect((await db.repo.findUniqueOrThrow({ where: { id: 100n } })).fullName).toBe('o/renamed');
    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).issueUrl).toBe('https://github.com/o/renamed/issues/7');
    // a transfer keeps the repo id and changes the owner
    expect(await dispatchWebhook(deps(), 'repository', { action: 'transferred', repository: { id: 100, full_name: 'new-owner/renamed' } })).toBe('repository.transferred:1');
    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).issueUrl).toBe('https://github.com/new-owner/renamed/issues/7');
    expect(await dispatchWebhook(deps(), 'repository', { action: 'edited', repository: { id: 100, full_name: 'o/x' } })).toBe('ignored');
    expect((await db.repo.findUniqueOrThrow({ where: { id: 100n } })).fullName).toBe('new-owner/renamed');
  });
  it('marks removed repos inactive, keeps the row, and ignores their commands and PRs', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await dispatchWebhook(deps(), 'installation_repositories', { action: 'added', installation: install.installation, repositories_added: [{ id: 101, full_name: 'o/r2', private: true }] });
    await db.bounty.create({ data: { id: 2n, repoId: 101n, issueNumber: 7, issueTitle: '', issueUrl: '', criteria: [], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300, deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date() } });
    const out = await dispatchWebhook(deps(), 'installation_repositories', {
      action: 'removed', installation: install.installation, repositories_removed: [{ id: 101 }],
    });
    expect(out).toContain('/-1');
    expect(await db.repo.count()).toBe(2); // never deleted: bounties reference it
    expect((await db.repo.findUniqueOrThrow({ where: { id: 101n } })).active).toBe(false);
    expect((await db.repo.findUniqueOrThrow({ where: { id: 100n } })).active).toBe(true);
    expect(await dispatchWebhook(deps(), 'issue_comment', {
      action: 'created', installation: { id: 9 }, repository: { id: 101, full_name: 'o/r2' },
      issue: { number: 7, state: 'open' }, comment: { id: 1, body: '/bounty 5 USDC 7d', user: { id: 55, login: 'm', type: 'User' } },
    })).toBe('ignored:inactive-repo');
    expect(await db.fundingIntent.count()).toBe(0);
    expect(await dispatchWebhook(deps(), 'pull_request', {
      action: 'opened', repository: { id: 101, full_name: 'o/r2' },
      pull_request: { id: 500, number: 3, body: 'Closes #7', merged: false, merged_at: null, state: 'open', head: { sha: 'abc' }, user: { id: 9, login: 'c', type: 'User' } },
    })).toBe('pull_request:0');
    expect(await db.pullRequest.count()).toBe(0);
    // re-added (e.g. installed again) becomes active
    await dispatchWebhook(deps(), 'installation_repositories', { action: 'added', installation: install.installation, repositories_added: [{ id: 101, full_name: 'o/r2', private: true }] });
    expect((await db.repo.findUniqueOrThrow({ where: { id: 101n } })).active).toBe(true);
  });
  it('routes a /bounty comment to the command handler', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    const out = await dispatchWebhook(deps(), 'issue_comment', {
      action: 'created', installation: { id: 9 }, repository: { id: 100, full_name: 'o/r' },
      issue: { number: 7, state: 'open' }, comment: { id: 1, body: '/bounty 5 USDC 7d', user: { id: 55, login: 'm', type: 'User' } },
    });
    expect(out).toBe('intent-created');
    expect(await db.fundingIntent.count()).toBe(1);
    expect(await dispatchWebhook(deps(), 'issue_comment', { action: 'edited' })).toBe('ignored');
  });
  it('issue edits refresh title and criteria of an active bounty only', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({ data: { id: 1n, repoId: 100n, issueNumber: 7, issueTitle: '', issueUrl: '', criteria: [], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300, deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date() } });
    const out = await dispatchWebhook(deps(), 'issues', { action: 'edited', repository: { id: 100 }, issue: { number: 7, title: 'New title', body: '## Acceptance criteria\n- [ ] one\n- [ ] two' } });
    expect(out).toBe('issues.edited:1');
    const b = await db.bounty.findUniqueOrThrow({ where: { id: 1n } });
    expect(b.issueTitle).toBe('New title');
    expect(b.criteria).toEqual(['one', 'two']);
  });
  it('audit-logs criteria change on OPEN bounty and posts comments on open linked PRs', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({
      data: {
        id: 10n, repoId: 100n, issueNumber: 20, issueTitle: 'Bounty 20', issueUrl: '',
        criteria: ['old criterion'], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300,
        deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date(),
      },
    });
    await db.pullRequest.create({
      data: { id: 201n, number: 201, authorGithubId: 11n, authorLogin: 'dev1', headSha: 'sha1', state: 'OPEN' },
    });
    await db.pullRequestBounty.create({ data: { prId: 201n, bountyId: 10n } });
    await db.pullRequest.create({
      data: { id: 202n, number: 202, authorGithubId: 12n, authorLogin: 'dev2', headSha: 'sha2', state: 'MERGED' },
    });
    await db.pullRequestBounty.create({ data: { prId: 202n, bountyId: 10n } });

    const out = await dispatchWebhook(deps(), 'issues', {
      action: 'edited',
      repository: { id: 100 },
      issue: { number: 20, title: 'Bounty 20 Updated', body: '## Acceptance criteria\n- [ ] new criterion 1\n- [ ] new criterion 2' },
      sender: { id: 99, login: 'maintainer' },
    });
    expect(out).toBe('issues.edited:1');

    const b = await db.bounty.findUniqueOrThrow({ where: { id: 10n } });
    expect(b.criteria).toEqual(['new criterion 1', 'new criterion 2']);

    const audits = await db.auditLog.findMany({ where: { target: 'bounty:10' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor: 'github:99',
      action: 'bounty.criteria_changed',
      target: 'bounty:10',
    });
    const auditData = audits[0]!.data as { old: string[]; new: string[] };
    expect(auditData.old).toEqual(['old criterion']);
    expect(auditData.new).toEqual(['new criterion 1', 'new criterion 2']);

    // Only open PR 201 is notified; merged PR 202 is skipped
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      bountyId: 10n,
      prNumber: 201,
    });
    expect(notifications[0]!.message).toContain('acceptance criteria');
    expect(notifications[0]!.message).toContain('new criterion 1');
  });
  it('does not audit-log or notify when criteria are unchanged on an OPEN bounty', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({
      data: {
        id: 11n, repoId: 100n, issueNumber: 21, issueTitle: 'Bounty 21', issueUrl: '',
        criteria: ['same criterion'], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300,
        deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date(),
      },
    });
    await db.pullRequest.create({
      data: { id: 211n, number: 211, authorGithubId: 11n, authorLogin: 'dev1', headSha: 'sha1', state: 'OPEN' },
    });
    await db.pullRequestBounty.create({ data: { prId: 211n, bountyId: 11n } });

    // Issue edited with different title but identical criteria
    const out = await dispatchWebhook(deps(), 'issues', {
      action: 'edited',
      repository: { id: 100 },
      issue: { number: 21, title: 'Bounty 21 Renamed', body: '## Acceptance criteria\n- [ ] same criterion' },
    });
    expect(out).toBe('issues.edited:1');

    const b = await db.bounty.findUniqueOrThrow({ where: { id: 11n } });
    expect(b.issueTitle).toBe('Bounty 21 Renamed');
    expect(b.criteria).toEqual(['same criterion']);

    // No audit-log entry and no comment on the PR
    expect(await db.auditLog.count({ where: { target: 'bounty:11' } })).toBe(0);
    expect(notifications).toHaveLength(0);
  });
  it('does not audit-log or notify when criteria change on a DISPUTED bounty', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({
      data: {
        id: 12n, repoId: 100n, issueNumber: 22, issueTitle: 'Disputed Bounty', issueUrl: '',
        criteria: ['initial criteria'], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300,
        deadline: new Date(), relayerAllowed: true, status: 'DISPUTED', fundTx: 't', createdAt: new Date(),
      },
    });
    await db.pullRequest.create({
      data: { id: 221n, number: 221, authorGithubId: 11n, authorLogin: 'dev1', headSha: 'sha1', state: 'OPEN' },
    });
    await db.pullRequestBounty.create({ data: { prId: 221n, bountyId: 12n } });

    const out = await dispatchWebhook(deps(), 'issues', {
      action: 'edited',
      repository: { id: 100 },
      issue: { number: 22, title: 'Disputed Bounty Edited', body: '## Acceptance criteria\n- [ ] changed criterion' },
    });
    expect(out).toBe('issues.edited:1');

    const b = await db.bounty.findUniqueOrThrow({ where: { id: 12n } });
    expect(b.criteria).toEqual(['changed criterion']);

    expect(await db.auditLog.count({ where: { target: 'bounty:12' } })).toBe(0);
    expect(notifications).toHaveLength(0);
  });
  it('notifies every open linked PR when criteria change on an OPEN bounty', async () => {
    await dispatchWebhook(deps(), 'installation', install);
    await db.bounty.create({
      data: {
        id: 13n, repoId: 100n, issueNumber: 23, issueTitle: 'Bounty 23', issueUrl: '',
        criteria: ['step 1'], maintainer: 'GM', token: 'C', amount: '1', feeBps: 300,
        deadline: new Date(), relayerAllowed: true, status: 'OPEN', fundTx: 't', createdAt: new Date(),
      },
    });
    await db.pullRequest.create({
      data: { id: 231n, number: 231, authorGithubId: 11n, authorLogin: 'dev1', headSha: 'sha1', state: 'OPEN' },
    });
    await db.pullRequestBounty.create({ data: { prId: 231n, bountyId: 13n } });
    await db.pullRequest.create({
      data: { id: 232n, number: 232, authorGithubId: 12n, authorLogin: 'dev2', headSha: 'sha2', state: 'OPEN' },
    });
    await db.pullRequestBounty.create({ data: { prId: 232n, bountyId: 13n } });

    await dispatchWebhook(deps(), 'issues', {
      action: 'edited',
      repository: { id: 100 },
      issue: { number: 23, title: 'Bounty 23', body: '## Acceptance criteria\n- [ ] step 1\n- [ ] step 2' },
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.prNumber).sort()).toEqual([231, 232]);
    expect(await db.auditLog.count({ where: { target: 'bounty:13' } })).toBe(1);
  });
  it('replays a fund event that arrived before the installation webhook', async () => {
    // The indexer sees the fund first, while the repo is not installed yet. The cursor moves on.
    const ev: ChainEvent = {
      kind: 'funded', id: 55n, maintainer: 'GMAINT', repoId: 100n, issue: 7n,
      token: 'CTOKEN', amount: 1000n, feeBps: 300, deadline: 1800000000n, relayerAllowed: true,
    };
    const meta = { eventId: '00000000000000000001', txHash: 'tx1', closedAt: new Date('2026-11-02T00:00:00Z') };
    expect(await db.$transaction((tx) => applyEvent(tx, ev, meta))).toBe('untracked');
    expect(await db.bounty.count()).toBe(0);
    expect(await db.untrackedFundEvent.count()).toBe(1);

    // Then the installation webhook arrives and upserts the repo.
    expect(await dispatchWebhook(deps(), 'installation', install)).toBe('installation.created');

    const bounty = await db.bounty.findUniqueOrThrow({ where: { id: 55n } });
    expect(bounty.status).toBe('OPEN');
    expect(bounty.issueNumber).toBe(7);
    expect(bounty.amount.toString()).toBe('1000');
    expect(bounty.fundTx).toBe('tx1');
    expect(await db.untrackedFundEvent.count()).toBe(0);
    // installing again does not duplicate the bounty
    await dispatchWebhook(deps(), 'installation', install);
    expect(await db.bounty.count()).toBe(1);
  });
  it('ignores unknown events', async () => {
    expect(await dispatchWebhook(deps(), 'star', {})).toBe('ignored');
  });
});

describe('queue round trip (real Redis)', () => {
  it('delivers a job to the worker once, even if enqueued twice with the same delivery id', async () => {
    const seen: WebhookJob[] = [];
    const id = randomUUID();
    const prod = webhookProducer(REDIS);
    const w = webhookWorker(REDIS, async (j) => void seen.push(j));
    try {
      await prod.enqueue(id, 'issues', { a: 1 });
      await prod.enqueue(id, 'issues', { a: 1 });
      for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id, deliveryId: id, event: 'issues', payload: { a: 1 } });
    } finally { await w.close(); await prod.close(); }
  });
});
