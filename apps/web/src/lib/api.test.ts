import { beforeEach, describe, expect, it } from 'vitest';
import {
  apiGet,
  apiGetWithMeta,
  cachePolicyFor,
  clearApiCache,
  daysLeft,
  invalidateCacheTag,
  money,
  PUBLIC_REVALIDATE,
  signRevalidatePayload,
  verifyRevalidateRequest,
} from './api';

describe('formatting', () => {
  it('formats money with two decimals and unknown tokens shortened', () => {
    expect(money('500000000', 'CABCDEF')).toBe('50.00 CABC…');
    expect(money('1', 'CABCDEF')).toBe('0.0000001 CABC…');
  });
  it('formats time left', () => {
    const now = Date.parse('2026-11-02T00:00:00Z');
    expect(daysLeft('2026-11-05T00:00:00Z', now)).toBe('3d left');
    expect(daysLeft('2026-11-02T05:00:00Z', now)).toBe('5h left');
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe('deadline passed');
  });
});

describe('public API caching and revalidation', () => {
  beforeEach(() => {
    clearApiCache();
  });

  it('assigns sensible revalidate windows and tags per endpoint', () => {
    expect(cachePolicyFor('/bounties?sort=newest')).toEqual({
      revalidate: PUBLIC_REVALIDATE.list,
      tags: ['bounties'],
      staleMaxAgeMs: 300_000,
    });
    expect(cachePolicyFor('/bounties/42')).toEqual({
      revalidate: PUBLIC_REVALIDATE.detail,
      tags: ['bounties', 'bounty:42'],
      staleMaxAgeMs: 300_000,
    });
    expect(cachePolicyFor('/users/alice')).toEqual({
      revalidate: PUBLIC_REVALIDATE.profile,
      tags: ['users', 'user:alice'],
      staleMaxAgeMs: 300_000,
    });
    expect(cachePolicyFor('/me/funded')).toBeNull();
    expect(cachePolicyFor('/auth/me')).toBeNull();
  });

  it('cache hit does not call the API twice within the revalidation window, and 100 repeated views hit the API once', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (_input, init) => {
      calls++;
      const nextOpts = (init as { next?: { revalidate: number; tags: string[] } } | undefined)?.next;
      expect(nextOpts).toEqual({ revalidate: 15, tags: ['bounties', 'bounty:7'] });
      return new Response(JSON.stringify({ id: '7', status: 'OPEN', call: calls }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 100; i++) {
      const res = await apiGet<{ id: string; status: string; call: number }>('/bounties/7', {
        fetchImpl: fakeFetch,
        now: t0 + i * 100, // 10 seconds total across 100 page views (< 15s revalidate)
      });
      expect(res).toEqual({ id: '7', status: 'OPEN', call: 1 });
    }
    expect(calls).toBe(1);
  });

  it('tag revalidation purges matching entries and refetches on the next read', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({ id: '7', status: calls === 1 ? 'OPEN' : 'RELEASED' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const t0 = 1_700_000_000_000;
    const first = await apiGet<{ id: string; status: string }>('/bounties/7', { fetchImpl: fakeFetch, now: t0 });
    expect(first?.status).toBe('OPEN');
    expect(calls).toBe(1);

    // Purge via tag before the 15s window expires
    expect(invalidateCacheTag('bounty:7')).toBe(1);

    const second = await apiGet<{ id: string; status: string }>('/bounties/7', { fetchImpl: fakeFetch, now: t0 + 1000 });
    expect(second?.status).toBe('RELEASED');
    expect(calls).toBe(2);
  });

  it('serves the last good response with stale=true when the API is down, for a bounded time', async () => {
    let apiUp = true;
    const fakeFetch: typeof fetch = async () => {
      if (!apiUp) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ items: [{ id: '1' }], nextCursor: null }), { status: 200 });
    };

    const t0 = 1_700_000_000_000;
    const fresh = await apiGetWithMeta<{ items: { id: string }[] }>('/bounties?', {
      fetchImpl: fakeFetch,
      now: t0,
      staleMaxAgeMs: 60_000,
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.data?.items).toHaveLength(1);

    // API goes down after the 15s revalidation window
    apiUp = false;
    const duringOutage = await apiGetWithMeta<{ items: { id: string }[] }>('/bounties?', {
      fetchImpl: fakeFetch,
      now: t0 + 20_000,
      staleMaxAgeMs: 60_000,
    });
    expect(duringOutage.stale).toBe(true);
    expect(duringOutage.data?.items).toEqual([{ id: '1' }]);

    // Past the bounded stale window (60s), stale data is no longer served
    const expiredOutage = await apiGetWithMeta<{ items: { id: string }[] }>('/bounties?', {
      fetchImpl: fakeFetch,
      now: t0 + 65_000,
      staleMaxAgeMs: 60_000,
    });
    expect(expiredOutage.data).toBeNull();
    expect(expiredOutage.stale).toBe(false);
  });

  it('never caches a request carrying a session cookie or targeting a per-user endpoint', async () => {
    let calls = 0;
    const seenCacheModes: (RequestCache | undefined)[] = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      calls++;
      seenCacheModes.push(init?.cache);
      return new Response(JSON.stringify({ viewerCall: calls }), { status: 200 });
    };

    const t0 = 1_700_000_000_000;
    const a = await apiGet<{ viewerCall: number }>('/bounties/7', {
      fetchImpl: fakeFetch,
      now: t0,
      cookie: 'se_session=user-secret-session-token',
    });
    const b = await apiGet<{ viewerCall: number }>('/bounties/7', {
      fetchImpl: fakeFetch,
      now: t0 + 100,
      headers: { Cookie: 'se_session=user-secret-session-token' },
    });
    expect(a?.viewerCall).toBe(1);
    expect(b?.viewerCall).toBe(2);
    expect(seenCacheModes).toEqual(['no-store', 'no-store']);

    // A subsequent anonymous request must not receive the user-specific response from cache
    const anon = await apiGet<{ viewerCall: number }>('/bounties/7', {
      fetchImpl: fakeFetch,
      now: t0 + 200,
    });
    expect(anon?.viewerCall).toBe(3);
  });
});

describe('verifyRevalidateRequest (HMAC + replay window)', () => {
  const secret = 'test-revalidate-shared-secret-32b';
  const body = JSON.stringify({ bountyId: '7', tags: ['bounties', 'bounty:7'] });
  const nowMs = 1_700_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  beforeEach(() => {
    clearApiCache();
  });

  it('accepts a valid HMAC signature within the replay window', () => {
    const sig = signRevalidatePayload(secret, body, nowSec);
    const res = verifyRevalidateRequest({
      secret,
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: String(nowSec),
      nowMs,
    });
    expect(res).toEqual({ ok: true });
  });

  it('rejects a bad signature and a tampered payload', () => {
    const sig = signRevalidatePayload('wrong-secret-00000000000000000000', body, nowSec);
    const badSecret = verifyRevalidateRequest({
      secret,
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: String(nowSec),
      nowMs,
    });
    expect(badSecret.ok).toBe(false);
    if (!badSecret.ok) expect(badSecret.status).toBe(401);

    const validSig = signRevalidatePayload(secret, body, nowSec);
    const tampered = verifyRevalidateRequest({
      secret,
      rawBody: JSON.stringify({ bountyId: '999', tags: ['bounties'] }),
      signatureHeader: validSig,
      timestampHeader: String(nowSec),
      nowMs,
    });
    expect(tampered.ok).toBe(false);
  });

  it('rejects an old timestamp outside the replay window and an exact replayed request', () => {
    const oldSec = nowSec - 600; // 10 minutes old (> 300s window)
    const oldSig = signRevalidatePayload(secret, body, oldSec);
    const expired = verifyRevalidateRequest({
      secret,
      rawBody: body,
      signatureHeader: oldSig,
      timestampHeader: String(oldSec),
      nowMs,
    });
    expect(expired).toEqual({ ok: false, status: 401, error: 'replayed or expired timestamp' });

    // Exact replay of an already-accepted (timestamp, signature) pair is also rejected
    const freshSig = signRevalidatePayload(secret, body, nowSec);
    const first = verifyRevalidateRequest({
      secret,
      rawBody: body,
      signatureHeader: freshSig,
      timestampHeader: String(nowSec),
      nowMs,
    });
    expect(first.ok).toBe(true);

    const replay = verifyRevalidateRequest({
      secret,
      rawBody: body,
      signatureHeader: freshSig,
      timestampHeader: String(nowSec),
      nowMs: nowMs + 1000,
    });
    expect(replay).toEqual({ ok: false, status: 401, error: 'replayed timestamp' });
  });
});
