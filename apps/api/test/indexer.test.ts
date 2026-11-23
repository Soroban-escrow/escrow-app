import { DisputeStatus } from '@prisma/client';
import { nativeToScVal, Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { applyEvent, decodeFundEvent } from '../src/indexer/apply.js';
import { decodeEvent, type ChainEvent } from '../src/indexer/decode.js';

const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://skillescrow:skillescrow@localhost:5432/skillescrow_test');
afterAll(() => db.$disconnect());

const addr = () => Keypair.random().publicKey();
const sym = (s: string) => nativeToScVal(s, { type: 'symbol' });
const u64 = (n: bigint) => nativeToScVal(n, { type: 'u64' });
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

describe('decodeEvent', () => {
  it('decodes funded like the real testnet event', () => {
    const maintainer = addr();
    const ev = decodeEvent({
      topic: [sym('bounty'), sym('funded'), u64(1n)],
      value: nativeToScVal(
        { amount: 100000000n, deadline: 1793802289n, fee_bps: 300, issue: 17n, maintainer, relayer_allowed: true, repo_id: 1n, token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' },
        { type: { amount: ['symbol', 'i128'], deadline: ['symbol', 'u64'], fee_bps: ['symbol', 'u32'], issue: ['symbol', 'u64'], maintainer: ['symbol', 'address'], relayer_allowed: ['symbol', 'bool'], repo_id: ['symbol', 'u64'], token: ['symbol', 'address'] } as never },
      ),
    });
    expect(ev).toMatchObject({ kind: 'funded', id: 1n, amount: 100000000n, feeBps: 300, relayerAllowed: true, maintainer });
  });
  it('ignores untracked and malformed events', () => {
    expect(decodeEvent({ topic: [sym('bounty'), sym('config'), sym('token')], value: nativeToScVal({}) })).toBeNull();
    expect(decodeEvent({ topic: [sym('other')], value: nativeToScVal({}) })).toBeNull();
    expect(decodeEvent({ topic: [sym('bounty'), sym('refunded')], value: nativeToScVal({}) })).toBeNull();
    expect(decodeEvent({ topic: [sym('bounty'), sym('refunded'), u64(1n)], value: nativeToScVal({ amount: 'x' }) })).toBeNull();
    expect(decodeEvent({ topic: [sym('bounty'), sym('funded'), u64(1n)], value: nativeToScVal({ fee_bps: -1 }) })).toBeNull();
  });

  it('never throws for random or truncated event shapes', () => {
    let seed = 0x9e3779b9;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const atoms: unknown[] = ['bounty', 'funded', 'released', 'refunded', 'disputed', 'resolved', 'config', 'other', 1n, 7n, 'x', null, true];
    const pick = () => atoms[Math.floor(rand() * atoms.length)] as never;
    for (let i = 0; i < 300; i++) {
      const topic = Array.from({ length: Math.floor(rand() * 5) }, () => nativeToScVal(pick()));
      const value = rand() < 0.1 ? undefined as never : nativeToScVal({ amount: pick(), fee_bps: pick() } as never);
      expect(() => decodeEvent({ topic, value })).not.toThrow();
      expect(decodeEvent({ topic, value })).toBeNull();
    }
  });
  it('decodes resolved with and without a winner', () => {
    const base = { fee: 1n, maintainer_amount: 2n, winner_net: 3n };
    const t = { fee: ['symbol', 'i128'], maintainer_amount: ['symbol', 'i128'], winner_net: ['symbol', 'i128'], winner: ['symbol', 'address'] } ;
    const w = addr();
    const a = decodeEvent({ topic: [sym('bounty'), sym('resolved'), u64(2n)], value: nativeToScVal({ ...base, winner: w }, { type: t as never }) });
    expect(a).toMatchObject({ kind: 'resolved', winner: w, winnerNet: 3n });
    const b = decodeEvent({ topic: [sym('bounty'), sym('resolved'), u64(2n)], value: nativeToScVal({ ...base, winner: null }, { type: t as never }) });
    expect(b).toMatchObject({ kind: 'resolved', winner: null });
  });
});

const meta = (n: number) => ({ eventId: String(n).padStart(20, '0'), txHash: `tx${n}`, closedAt: new Date('2026-11-02T00:00:00Z') });
const funded = (over: Partial<Extract<ChainEvent, { kind: 'funded' }>> = {}): ChainEvent => ({
  kind: 'funded', id: 1n, maintainer: addr(), repoId: 100n, issue: 7n, token: 'CTOKEN', amount: 1000n, feeBps: 300, deadline: 1800000000n, relayerAllowed: true, ...over,
});
const run = (ev: ChainEvent, n: number) => db.$transaction((tx) => applyEvent(tx, ev, meta(n)));

describe('applyEvent', () => {
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Payout","Dispute","PullRequestBounty","PullRequest","Bounty","FundingIntent","UntrackedFundEvent","Repo","Installation" CASCADE');
    await db.installation.create({ data: { id: 1n, accountLogin: 'o', accountType: 'User' } });
    await db.repo.create({ data: { id: 100n, installationId: 1n, fullName: 'o/r', private: false } });
  });

  it('funds, releases, and ignores a replay', async () => {
    expect(await run(funded(), 1)).toBe('applied');
    expect(await run(funded(), 1)).toBe('stale');
    const w = addr();
    expect(await run({ kind: 'released', id: 1n, winner: w, net: 970n, fee: 30n, caller: w }, 2)).toBe('applied');
    expect(await run({ kind: 'released', id: 1n, winner: w, net: 970n, fee: 30n, caller: w }, 2)).toBe('stale');
    const b = await db.bounty.findUniqueOrThrow({ where: { id: 1n } });
    expect(b.status).toBe('RELEASED');
    expect(b.winnerAddress).toBe(w);
    expect(b.amount.toString()).toBe('1000');
    expect(b.closeTx).toBe('tx2');
  });

  it('orders event ids across TOID and index digit-length boundaries', async () => {
    const w = addr();
    const release = (id: bigint): ChainEvent => ({ kind: 'released', id, winner: w, net: 970n, fee: 30n, caller: w });
    await db.$transaction((tx) => applyEvent(tx, funded(), { ...meta(1), eventId: '9999999999999999999-0000000001' }));
    expect(await db.$transaction((tx) => applyEvent(tx, release(1n), { ...meta(2), eventId: '10000000000000000000-0000000000' }))).toBe('applied');
    expect(await db.$transaction((tx) => applyEvent(tx, release(1n), { ...meta(1), eventId: '9999999999999999999-0000000001' }))).toBe('stale');

    await db.$transaction((tx) => applyEvent(tx, funded({ id: 2n }), { ...meta(3), eventId: '0000000000000000123-0000000009' }));
    expect(await db.$transaction((tx) => applyEvent(tx, release(2n), { ...meta(4), eventId: '0000000000000000123-0000000010' }))).toBe('applied');
    expect(await db.$transaction((tx) => applyEvent(tx, release(2n), { ...meta(3), eventId: '0000000000000000123-0000000009' }))).toBe('stale');
  });

  it('replaying an old event against a later state is stale, not an anomaly', async () => {
    await run(funded(), 1);
    await run({ kind: 'disputed', id: 1n, caller: addr() }, 2);
    await run({ kind: 'resolved', id: 1n, winner: null, winnerNet: 0n, fee: 0n, maintainerAmount: 1000n }, 3);
    expect(await run({ kind: 'disputed', id: 1n, caller: addr() }, 2)).toBe('stale');
    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).status).toBe('RESOLVED');
  });

  it('passes by repos we do not track and unknown bounties', async () => {
    expect(await run(funded({ repoId: 999n }), 1)).toBe('untracked');
    expect(await run({ kind: 'refunded', id: 5n, amount: 1n }, 2)).toBe('untracked');
    expect(await db.bounty.count()).toBe(0);
  });

  it('parks a funded event for an untracked repo so it can be replayed later', async () => {
    const ev = funded({ repoId: 999n, id: 42n }) as Extract<ChainEvent, { kind: 'funded' }>;
    expect(await run(ev, 1)).toBe('untracked');
    const row = await db.untrackedFundEvent.findUniqueOrThrow({ where: { id: 42n } });
    expect(row.repoId).toBe(999n);
    const { ev: decoded, meta: decodedMeta } = decodeFundEvent(row.payload);
    expect(decoded).toEqual(ev);
    expect(decodedMeta).toEqual(meta(1));
    // re-seeing the same event is idempotent: one stored row, not two
    expect(await run(ev, 1)).toBe('untracked');
    expect(await db.untrackedFundEvent.count()).toBe(1);
  });

  it('dispute requests follow the chain: opened_onchain, then resolved', async () => {
    await run(funded(), 1);
    await db.dispute.create({ data: { bountyId: 1n, openedByGithubId: 9n, reason: 'x', evidence: {}, status: DisputeStatus.REQUESTED } });
    await run({ kind: 'disputed', id: 1n, caller: addr() }, 2);
    expect((await db.dispute.findFirstOrThrow()).status).toBe(DisputeStatus.OPENED_ONCHAIN);
    await run({ kind: 'resolved', id: 1n, winner: null, winnerNet: 0n, fee: 0n, maintainerAmount: 1000n }, 3);
    expect((await db.dispute.findFirstOrThrow()).status).toBe(DisputeStatus.RESOLVED);
  });

  it('refund, and an impossible transition is an anomaly', async () => {
    await run(funded(), 1);
    expect(await run({ kind: 'refunded', id: 1n, amount: 1000n }, 2)).toBe('applied');
    expect(await run({ kind: 'disputed', id: 1n, caller: addr() }, 3)).toBe('anomaly');
    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).status).toBe('REFUNDED');
  });

  it('marks the matching funding intent used and confirms payouts on release', async () => {
    await db.fundingIntent.create({ data: { id: 'i1', repoId: 100n, issueNumber: 7, requestedBy: 55n, token: 'CTOKEN', amount: '1000', durationDays: 7, commentId: 1n, expiresAt: new Date(Date.now() + 1e6) } });
    await run(funded(), 1);
    expect((await db.fundingIntent.findUniqueOrThrow({ where: { id: 'i1' } })).usedAt).not.toBeNull();
    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).maintainerGithubId).toBe(55n);
    await db.payout.create({ data: { bountyId: 1n, prNumber: 3, winnerGithubId: 9n, status: 'QUEUED', idempotencyKey: 'release:1' } });
    const w = addr();
    await run({ kind: 'released', id: 1n, winner: w, net: 970n, fee: 30n, caller: w }, 2);
    expect((await db.payout.findUniqueOrThrow({ where: { idempotencyKey: 'release:1' } })).status).toBe('CONFIRMED');
  });

  it('attributes a funded event to the tx-bound intent, not a newer equal-amount one', async () => {
    const first = { repoId: 100n, issueNumber: 7, token: 'CTOKEN', amount: '1000', durationDays: 7, commentId: 1n, expiresAt: new Date(Date.now() + 1e6) };
    await db.fundingIntent.create({ data: { ...first, id: 'older', requestedBy: 11n, createdAt: new Date('2026-01-01') } });
    await db.fundingIntent.create({ data: { ...first, id: 'newer', requestedBy: 22n, createdAt: new Date('2026-02-01') } });
    await db.fundingSubmission.create({ data: { intentId: 'older', txHash: 'tx1' } });
    const warnings: string[] = [];
    await db.$transaction((tx) => applyEvent(tx, funded(), { ...meta(1), log: (m) => warnings.push(m) }));

    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).maintainerGithubId).toBe(11n);
    expect((await db.fundingIntent.findUniqueOrThrow({ where: { id: 'older' } })).usedAt).not.toBeNull();
    expect((await db.fundingIntent.findUniqueOrThrow({ where: { id: 'newer' } })).usedAt).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('uses the fuzzy match only as a fallback, with a logged warning', async () => {
    await db.fundingIntent.create({ data: { id: 'i1', repoId: 100n, issueNumber: 7, requestedBy: 55n, token: 'CTOKEN', amount: '1000', durationDays: 7, commentId: 1n, expiresAt: new Date(Date.now() + 1e6) } });
    const warnings: string[] = [];
    await db.$transaction((tx) => applyEvent(tx, funded(), { ...meta(1), log: (m) => warnings.push(m) }));

    expect((await db.bounty.findUniqueOrThrow({ where: { id: 1n } })).maintainerGithubId).toBe(55n);
    expect(warnings.join('|')).toContain('fuzzily');
  });
});
