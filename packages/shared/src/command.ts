import { toBaseUnits } from './amounts.js';

export type Command =
  | { kind: 'fund'; amount: bigint; token: 'USDC' | 'XLM'; days: number }
  | { kind: 'dispute'; reason: string }
  | { kind: 'review' }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const DEFAULT_DAYS = 14;

/** Parses the FIRST line of an issue comment. Returns null if it is not a /bounty command. */
export function parseCommand(body: string): Command | null {
  const first = body.replace(/^\s+/, '').split(/\r?\n/, 1)[0] ?? '';
  const parts = first.trim().split(/\s+/);
  if ((parts[0] ?? '').toLowerCase() !== '/bounty') return null;
  const rest = parts.slice(1);
  const head = (rest[0] ?? '').toLowerCase();
  if (head === 'help' || rest.length === 0) return { kind: 'help' };
  if (head === 'review') return { kind: 'review' };
  if (head === 'dispute') {
    const reason = rest.slice(1).join(' ').trim();
    return reason ? { kind: 'dispute', reason } : { kind: 'error', message: 'Please give a reason: /bounty dispute <reason>' };
  }
  let amount: bigint;
  try {
    amount = toBaseUnits(rest[0]!);
  } catch {
    return { kind: 'error', message: `Invalid amount "${rest[0]}".` };
  }
  if (amount <= 0n) return { kind: 'error', message: 'Amount must be greater than zero.' };
  let token: 'USDC' | 'XLM' = 'USDC';
  let days = DEFAULT_DAYS;
  for (const p of rest.slice(1)) {
    const up = p.toUpperCase();
    const d = /^(\d{1,3})D$/.exec(up);
    if (up === 'USDC' || up === 'XLM') token = up;
    else if (d) days = Number(d[1]);
    else return { kind: 'error', message: `Unrecognised "${p}". Usage: /bounty <amount> [USDC|XLM] [<days>d]` };
  }
  if (days < 1) return { kind: 'error', message: 'Duration must be at least 1 day.' };
  return { kind: 'fund', amount, token, days };
}
