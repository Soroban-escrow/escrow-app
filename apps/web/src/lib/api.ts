import { fromBaseUnits } from '@skillescrow/shared/src/amounts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export interface BountySummary {
  id: string; issueNumber: number; issueTitle: string; issueUrl: string; amount: string; token: string; status: string;
  deadline: string; createdAt: string; repo: { fullName: string }; _count: { prs: number };
}

/** Server-side fetch of the public API. Returns null on any failure so pages render an error state. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
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
