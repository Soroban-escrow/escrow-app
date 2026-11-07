import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromBaseUnits } from '@skillescrow/shared/src/amounts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Default revalidation windows (in seconds) by public endpoint category. */
export const PUBLIC_REVALIDATE = {
  list: 15,
  detail: 15,
  profile: 60,
} as const;

/** Bounded window (ms) during which the last good cached response may be served if the API is down. */
export const DEFAULT_STALE_MAX_AGE_MS = 5 * 60 * 1000;

/** Allowed clock skew / replay window (seconds) for signed POST /api/revalidate requests. */
export const REVALIDATE_REPLAY_WINDOW_SEC = 300;

export interface BountySummary {
  id: string; issueNumber: number; issueTitle: string; issueUrl: string; amount: string; token: string; status: string;
  deadline: string; createdAt: string; repo: { fullName: string }; _count: { prs: number };
}

export interface CachePolicy {
  revalidate: number;
  tags: string[];
  staleMaxAgeMs: number;
}

export interface ApiGetOptions {
  headers?: Record<string, string | undefined>;
  cookie?: string;
  cache?: RequestCache;
  revalidate?: number;
  tags?: string[];
  staleMaxAgeMs?: number;
  now?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiGetResult<T> {
  data: T | null;
  stale: boolean;
  cachedAt: number | null;
}

interface CacheEntry {
  data: unknown;
  tags: Set<string>;
  fetchedAt: number;
  revalidateAt: number;
  staleUntil: number;
}

const dataCache = new Map<string, CacheEntry>();
const seenRevalidateSignatures = new Map<string, number>();

/**
 * Determines the Next.js Data Cache policy (`revalidate` seconds + cache `tags`) for a given API path.
 * Returns `null` for signed-in / per-user endpoints so they are never placed in the shared cache.
 */
export function cachePolicyFor(path: string, overrides?: Pick<ApiGetOptions, 'revalidate' | 'tags' | 'staleMaxAgeMs'>): CachePolicy | null {
  const [pathname = ''] = path.split('?');
  if (
    pathname.startsWith('/me') ||
    pathname === '/me' ||
    pathname.startsWith('/auth/') ||
    pathname === '/auth' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/wallet') ||
    pathname.startsWith('/tx')
  ) {
    return null;
  }

  const staleMaxAgeMs = overrides?.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;

  if (pathname === '/bounties' || pathname === '/bounties/') {
    return {
      revalidate: overrides?.revalidate ?? PUBLIC_REVALIDATE.list,
      tags: overrides?.tags ?? ['bounties'],
      staleMaxAgeMs,
    };
  }

  const bountyMatch = /^\/bounties\/([^/]+)$/.exec(pathname);
  if (bountyMatch?.[1]) {
    const id = decodeURIComponent(bountyMatch[1]);
    return {
      revalidate: overrides?.revalidate ?? PUBLIC_REVALIDATE.detail,
      tags: overrides?.tags ?? ['bounties', `bounty:${id}`],
      staleMaxAgeMs,
    };
  }

  const userMatch = /^\/users\/([^/]+)$/.exec(pathname);
  if (userMatch?.[1]) {
    const login = decodeURIComponent(userMatch[1]);
    return {
      revalidate: overrides?.revalidate ?? PUBLIC_REVALIDATE.profile,
      tags: overrides?.tags ?? ['users', `user:${login}`],
      staleMaxAgeMs,
    };
  }

  return {
    revalidate: overrides?.revalidate ?? PUBLIC_REVALIDATE.list,
    tags: overrides?.tags ?? ['public'],
    staleMaxAgeMs,
  };
}

/** True when a request carries session cookies, auth headers, or explicit `no-store`. */
export function hasUserCredentials(options?: ApiGetOptions): boolean {
  if (!options) return false;
  if (options.cache === 'no-store') return true;
  if (options.cookie && options.cookie.trim().length > 0) return true;
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      if (!v || !v.trim()) continue;
      const lower = k.toLowerCase();
      if (lower === 'cookie' || lower === 'authorization' || lower === 'x-csrf-token') {
        return true;
      }
    }
  }
  return false;
}

/** Purges matching entries from the in-memory revalidation cache so the next read refetches immediately. */
export function invalidateCacheTag(tag: string): number {
  let count = 0;
  for (const entry of dataCache.values()) {
    if (entry.tags.has(tag)) {
      entry.revalidateAt = 0;
      count++;
    }
  }
  return count;
}

/** Clears all in-memory cache and replay state (useful in tests). */
export function clearApiCache(): void {
  dataCache.clear();
  seenRevalidateSignatures.clear();
}

/**
 * Server-side fetch of the public API with Next.js Data Cache (`next: { revalidate, tags }`)
 * and bounded stale-while-revalidate fallback when the API is unreachable or restarting.
 * Signed-in and per-user requests always use `cache: 'no-store'` and never touch the shared cache.
 */
export async function apiGetWithMeta<T>(path: string, options?: ApiGetOptions): Promise<ApiGetResult<T>> {
  const fetcher = options?.fetchImpl ?? fetch;
  const now = options?.now ?? Date.now();
  const isPrivate = hasUserCredentials(options);
  const policy = isPrivate ? null : cachePolicyFor(path, options);

  const reqHeaders: Record<string, string> = {};
  if (options?.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      if (v !== undefined) reqHeaders[k] = v;
    }
  }
  if (options?.cookie) {
    reqHeaders.cookie = options.cookie;
  }

  // Signed-in / per-user requests bypass the shared cache entirely.
  if (!policy) {
    try {
      const init: RequestInit = { cache: 'no-store' };
      if (Object.keys(reqHeaders).length > 0) init.headers = reqHeaders;
      const r = await fetcher(`${API}${path}`, init);
      if (!r.ok) return { data: null, stale: false, cachedAt: null };
      return { data: (await r.json()) as T, stale: false, cachedAt: null };
    } catch {
      return { data: null, stale: false, cachedAt: null };
    }
  }

  const existing = dataCache.get(path);
  if (existing && now < existing.revalidateAt) {
    return { data: existing.data as T, stale: false, cachedAt: existing.fetchedAt };
  }

  try {
    const init: RequestInit & { next?: { revalidate: number; tags: string[] } } = {
      next: { revalidate: policy.revalidate, tags: policy.tags },
    };
    if (Object.keys(reqHeaders).length > 0) init.headers = reqHeaders;

    const r = await fetcher(`${API}${path}`, init);
    if (r.ok) {
      const data = (await r.json()) as T;
      dataCache.set(path, {
        data,
        tags: new Set(policy.tags),
        fetchedAt: now,
        revalidateAt: now + policy.revalidate * 1000,
        staleUntil: now + policy.staleMaxAgeMs,
      });
      return { data, stale: false, cachedAt: now };
    }

    // 4xx (such as 404 Not Found) is an authoritative negative response, not an API outage.
    if (r.status >= 400 && r.status < 500) {
      dataCache.delete(path);
      return { data: null, stale: false, cachedAt: null };
    }

    // 5xx: serve stale data if still within the bounded stale window.
    if (existing && now < existing.staleUntil) {
      return { data: existing.data as T, stale: true, cachedAt: existing.fetchedAt };
    }
    return { data: null, stale: false, cachedAt: null };
  } catch {
    if (existing && now < existing.staleUntil) {
      return { data: existing.data as T, stale: true, cachedAt: existing.fetchedAt };
    }
    return { data: null, stale: false, cachedAt: null };
  }
}

/** Server-side fetch of the public API. Returns null on any failure so pages render an error state. */
export async function apiGet<T>(path: string, options?: ApiGetOptions): Promise<T | null> {
  const res = await apiGetWithMeta<T>(path, options);
  return res.data;
}

/** Computes `sha256=<hex>` HMAC over `${timestampSec}.${rawBody}` for POST /api/revalidate. */
export function signRevalidatePayload(secret: string, rawBody: string, timestampSec: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `sha256=${mac}`;
}

export interface VerifyRevalidateInput {
  secret: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  nowMs?: number;
  replayWindowSec?: number;
}

export type VerifyRevalidateOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Verifies the HMAC signature and timestamp replay window for POST /api/revalidate
 * in constant time using `timingSafeEqual`.
 */
export function verifyRevalidateRequest(input: VerifyRevalidateInput): VerifyRevalidateOutcome {
  const {
    secret,
    rawBody,
    signatureHeader,
    timestampHeader,
    nowMs = Date.now(),
    replayWindowSec = REVALIDATE_REPLAY_WINDOW_SEC,
  } = input;

  if (!secret) {
    return { ok: false, status: 503, error: 'revalidation secret not configured' };
  }
  if (!timestampHeader || !/^\d+$/.test(timestampHeader.trim())) {
    return { ok: false, status: 401, error: 'missing or invalid timestamp' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, status: 401, error: 'missing or invalid signature' };
  }

  const tsSec = Number(timestampHeader.trim());
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isFinite(tsSec) || Math.abs(nowSec - tsSec) > replayWindowSec) {
    return { ok: false, status: 401, error: 'replayed or expired timestamp' };
  }

  const hex = signatureHeader.slice(7);
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return { ok: false, status: 401, error: 'invalid signature' };
  }

  const given = Buffer.from(hex, 'hex');
  const expected = createHmac('sha256', secret).update(`${tsSec}.${rawBody}`).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'invalid signature' };
  }

  // Evict expired replay entries and reject exact duplicate replays within the window.
  for (const [k, exp] of seenRevalidateSignatures.entries()) {
    if (exp < nowSec) seenRevalidateSignatures.delete(k);
  }
  const replayKey = `${tsSec}:${hex.toLowerCase()}`;
  if (seenRevalidateSignatures.has(replayKey)) {
    return { ok: false, status: 401, error: 'replayed timestamp' };
  }
  seenRevalidateSignatures.set(replayKey, tsSec + replayWindowSec);

  return { ok: true };
}

// Token symbols by contract id come from the environment; unknown tokens show a short id.
export function symbolFor(token: string): string {
  const map: Record<string, string> = {};
  if (process.env.NEXT_PUBLIC_TOKEN_USDC) map[process.env.NEXT_PUBLIC_TOKEN_USDC] = 'USDC';
  if (process.env.NEXT_PUBLIC_TOKEN_XLM) map[process.env.NEXT_PUBLIC_TOKEN_XLM] = 'XLM';
  return map[token] ?? `${token.slice(0, 4)}…`;
}

export const money = (amount: string, token: string) => `${fromBaseUnits(BigInt(amount), 7, 2)} ${symbolFor(token)}`;

export function daysLeft(deadline: string, now = Date.now()): string {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'deadline passed';
  const d = Math.floor(ms / 864e5);
  return d >= 1 ? `${d}d left` : `${Math.max(1, Math.floor(ms / 36e5))}h left`;
}

export const explorerTx = (hash: string) =>
  (process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE ?? 'https://stellar.expert/explorer/testnet/tx/{hash}').replace('{hash}', encodeURIComponent(hash));

/** Share of the bounty's lifetime still remaining, 0..1 (drives the deadline bar). */
export function timeLeftFraction(createdAt: string, deadline: string, now = Date.now()): number {
  const start = new Date(createdAt).getTime(), end = new Date(deadline).getTime();
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** Sums amounts per token, e.g. "170.00 USDC" or "20.00 USDC + 5.00 XLM". */
export function totals(items: { amount: string; token: string }[]): string {
  const by = new Map<string, bigint>();
  for (const i of items) by.set(i.token, (by.get(i.token) ?? 0n) + BigInt(i.amount));
  return [...by].map(([t, a]) => money(a.toString(), t)).join(' + ') || '0.00';
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
