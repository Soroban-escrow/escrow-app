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
const deps = (): DispatchDeps => ({
  db,
  commands: {
    db, webUrl: 'https://app.test', minDays: 1, maxDays: 90,
    tokens: { USDC: { address: 'CUSDC', min: 10_000_000n, max: 5_000_000_000n }, XLM: { address: 'CXLM', min: 1n, max: 9n } },
    gh: { getPermission: async () => 'write', postComment: async (_i, _r, _n, b) => (comments.push(b), 1n) },
  },
  pulls: { db, webUrl: 'https://app.test', chain: { getBounty: async () => ({ status: 'Open', relayerAllowed: true, maintainer: 'GM' }) }, notifier: { notify: async () => {} } },
});

beforeEach(async () => {
  comments = [];
  await db.$executeRawUnsafe('TRUNCATE "Payout","PullRequestBounty","PullRequest","Bounty","FundingIntent","UntrackedFundEvent","Repo","Installation" CASCADE');
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
      expect(seen[0]).toMatchObject({ id, event: 'issues', payload: { a: 1 } });
    } finally { await w.close(); await prod.close(); }
  });
});
