import { fromBaseUnits } from '@skillescrow/shared/src/amounts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export interface BountySummary {
  id: string; issueNumber: number; issueTitle: string; issueUrl: string; amount: string; token: string; status: string;
  deadline: string; createdAt: string; repo: { fullName: string }; _count: { prs: number };
}
export interface TokenInfo { address: string; symbol: string; decimals: number; minAmount?: string | null; maxAmount?: string | null }

/** Server-side fetch of the public API. Returns null on any failure so pages render an error state. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function symbolFor(token: string, tokens: TokenInfo[] = []): string {
  const configured = tokens.find((item) => item.address === token)?.symbol;
  if (configured) return configured;
  if (process.env.NEXT_PUBLIC_TOKEN_USDC === token) return 'USDC';
  if (process.env.NEXT_PUBLIC_TOKEN_XLM === token) return 'XLM';
  return `${token.slice(0, 4)}…`;
}

/** Distinguishes an unavailable API from an actual missing resource. */
export async function apiGetResult<T>(path: string): Promise<{ kind: 'ok'; data: T } | { kind: 'not_found' } | { kind: 'unavailable' }> {
  try {
    const r = await fetch(`${API}${path}`, { cache: 'no-store' });
    if (r.ok) return { kind: 'ok', data: (await r.json()) as T };
    return r.status === 404 ? { kind: 'not_found' } : { kind: 'unavailable' };
  } catch { return { kind: 'unavailable' }; }
}

export function refundWindow(deadline: string, graceMs = 72 * 3600e3, now = Date.now()): { open: boolean; label: string } {
  const ms = new Date(deadline).getTime() + graceMs - now;
  if (ms <= 0) return { open: true, label: 'Refund window is open' };
  const hours = Math.ceil(ms / 3600e3);
  return { open: false, label: `Refund available in ${hours >= 48 ? `${Math.ceil(hours / 24)}d` : `${hours}h`}` };
}

export function money(amount: string, token: string, tokens: TokenInfo[] = []): string {
  const info = tokens.find((item) => item.address === token) ?? (
    process.env.NEXT_PUBLIC_TOKEN_USDC === token ? { address: token, symbol: 'USDC', decimals: 7 } :
    process.env.NEXT_PUBLIC_TOKEN_XLM === token ? { address: token, symbol: 'XLM', decimals: 7 } : undefined
  );
  return info ? `${fromBaseUnits(BigInt(amount), info.decimals, 2)} ${info.symbol}` : `${amount} ${symbolFor(token, tokens)} (unknown token)`;
}

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
export function totals(items: { amount: string; token: string }[], tokens: TokenInfo[] = []): string {
  const by = new Map<string, bigint>();
  for (const i of items) by.set(i.token, (by.get(i.token) ?? 0n) + BigInt(i.amount));
  return [...by].map(([t, a]) => money(a.toString(), t, tokens)).join(' + ') || '0.00';
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatAddress(address: string, startChars = 8, endChars = 4): { display: string; full: string } {
  if (address.length <= startChars + endChars + 3) return { display: address, full: address };
  return { display: `${address.slice(0, startChars)}…${address.slice(-endChars)}`, full: address };
}

