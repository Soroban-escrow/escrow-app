import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { sendRefundReminders } from '../src/ops/reminders.js';

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());
const H = 3600e3, GRACE = 72 * H, T0 = new Date('2026-11-02T00:00:00Z').getTime();
let posted: { id: bigint; body: string }[];
let failIds: Set<bigint>;
let logged: { msg: string; extra?: unknown }[];
const deps = (at: number) => ({
  db, graceMs: GRACE, webUrl: 'https://app.test', now: () => new Date(at),
  log: (msg: string, extra?: unknown) => void logged.push({ msg, extra }),
  commenter: {
    comment: async (id: bigint, body: string) => {
      if (failIds.has(id)) throw Object.assign(new Error('github down'), { status: 404 });
      posted.push({ id, body });
    },
  },
});

const bounty = (id: bigint, issueNumber: number) => ({
  id, repoId: 100n, issueNumber, issueTitle: '', issueUrl: '', criteria: [],
  maintainer: 'GM', token: 'C', amount: '1', feeBps: 300, deadline: new Date(T0),
  relayerAllowed: true, status: 'OPEN' as const, fundTx: 't', createdAt: new Date(T0),
});

beforeEach(async () => {
  posted = []; failIds = new Set(); logged = [];
  await db.$executeRawUnsafe('TRUNCATE "AuditLog","Bounty","Repo","Installation" CASCADE');
  await db.installation.create({ data: { id: 1n, accountLogin: 'o', accountType: 'User' } });
  await db.repo.create({ data: { id: 100n, installationId: 1n, fullName: 'o/r', private: false } });
  await db.bounty.create({ data: bounty(1n, 1) });
});

describe('sendRefundReminders', () => {
  it('stays quiet while the window is far away', async () => {
    expect(await sendRefundReminders(deps(T0))).toEqual([]); // window opens at T0+72h; reminders start at T0+24h
    expect(await sendRefundReminders(deps(T0 + 24 * H - 1))).toEqual([]);
    expect(await sendRefundReminders(deps(T0 + 24 * H))).toEqual(['soon:1']); // boundary is inclusive
  });
  it('sends "soon" 48 h before the window opens and "open" when it opens, once each', async () => {
    expect(await sendRefundReminders(deps(T0 + 23 * H))).toEqual([]);
    expect(await sendRefundReminders(deps(T0 + 30 * H))).toEqual(['soon:1']);
    expect(await sendRefundReminders(deps(T0 + 31 * H))).toEqual([]); // not repeated
    expect(await sendRefundReminders(deps(T0 + 73 * H))).toEqual(['open:1']);
    expect(await sendRefundReminders(deps(T0 + 80 * H))).toEqual([]);
    expect(posted.map((p) => p.body.slice(0, 22))).toEqual(['The refund window for ', 'The refund window for ']);
    expect(posted[1]!.body).toContain('now open');
  });
  it('a failed comment is retried on the next tick (not marked as sent)', async () => {
    failIds.add(1n);
    expect(await sendRefundReminders(deps(T0 + 30 * H))).toEqual([]); // no longer aborts the pass
    expect(logged).toHaveLength(1);
    expect((logged[0]!.extra as { bountyId: string }).bountyId).toBe('1');
    failIds.clear();
    expect(await sendRefundReminders(deps(T0 + 31 * H))).toEqual(['soon:1']);
  });
  it('one failing bounty does not stop reminders for the bounties after it', async () => {
    await db.bounty.create({ data: bounty(2n, 2) });
    await db.bounty.create({ data: bounty(3n, 3) });
    failIds.add(2n); // e.g. a deleted issue returns 404

    expect(await sendRefundReminders(deps(T0 + 30 * H))).toEqual(['soon:1', 'soon:3']);
    expect(posted.map((p) => p.id)).toEqual([1n, 3n]);
    expect(logged).toHaveLength(1);
    expect((logged[0]!.extra as { bountyId: string }).bountyId).toBe('2');
    expect(await db.auditLog.count()).toBe(2); // failed one was not marked as sent

    // it is retried on the next tick once GitHub recovers
    failIds.clear();
    expect(await sendRefundReminders(deps(T0 + 31 * H))).toEqual(['soon:2']);
    expect(posted.map((p) => p.id)).toEqual([1n, 3n, 2n]);
  });
  it('ignores bounties that are no longer open', async () => {
    await db.bounty.update({ where: { id: 1n }, data: { status: 'RELEASED' } });
    expect(await sendRefundReminders(deps(T0 + 80 * H))).toEqual([]);
  });
});
