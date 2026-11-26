import { afterEach, describe, expect, it, vi } from 'vitest';
import { daysLeft, explorerTx, money, plural, refundWindow, symbolFor, timeLeftFraction, totals, type TokenInfo } from './api';

const tokens: TokenInfo[] = [
  { address: 'T6', symbol: 'USD6', decimals: 6 },
  { address: 'T7', symbol: 'XLM', decimals: 7 },
  { address: 'T18', symbol: 'EVM', decimals: 18 },
];

afterEach(() => vi.unstubAllEnvs());

describe('money', () => {
  it('uses API token precision and never guesses precision for an unknown token', () => {
    expect(money('1234567', 'T6', tokens)).toBe('1.234567 USD6');
    expect(money('500000000', 'T7', tokens)).toBe('50.00 XLM');
    expect(money('1234567890123456789', 'T18', tokens)).toBe('1.234567890123456789 EVM');
    expect(money('500000000', 'CABCDEF', tokens)).toBe('500000000 CABC… (unknown token)');
  });

  it('renders a zero amount in the token precision', () => {
    expect(money('0', 'T6', tokens)).toBe('0.00 USD6');
    expect(money('0', 'T7', tokens)).toBe('0.00 XLM');
  });

  it('falls back to the configured env token when no token list is given', () => {
    vi.stubEnv('NEXT_PUBLIC_TOKEN_USDC', 'CUSD');
    expect(money('10000000', 'CUSD')).toBe('1.00 USDC');
    expect(symbolFor('CUSD')).toBe('USDC');
  });

  it('shows a short address for a token that is not configured', () => {
    expect(symbolFor('CABCDEF', tokens)).toBe('CABC…');
  });
});

describe('daysLeft', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');

  it('formats whole days and hours', () => {
    expect(daysLeft('2026-11-05T00:00:00Z', now)).toBe('3d left');
    expect(daysLeft('2026-11-02T05:00:00Z', now)).toBe('5h left');
  });

  it('rounds a partially elapsed day up to at least one hour', () => {
    expect(daysLeft('2026-11-02T00:30:00Z', now)).toBe('1h left');
  });

  it('reports a past deadline, including exactly at the deadline', () => {
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe('deadline passed');
    expect(daysLeft('2026-11-02T00:00:00Z', now)).toBe('deadline passed');
  });
});

describe('timeLeftFraction', () => {
  const created = '2026-11-01T00:00:00Z';
  const deadline = '2026-11-11T00:00:00Z';

  it('returns the share of the bounty lifetime still remaining', () => {
    expect(timeLeftFraction(created, deadline, Date.parse('2026-11-06T00:00:00Z'))).toBe(0.5);
    expect(timeLeftFraction(created, deadline, Date.parse('2026-11-01T00:00:00Z'))).toBe(1);
  });

  it('clamps to 0 once the deadline has passed and to 1 before funding', () => {
    expect(timeLeftFraction(created, deadline, Date.parse('2026-11-20T00:00:00Z'))).toBe(0);
    expect(timeLeftFraction(created, deadline, Date.parse('2026-10-01T00:00:00Z'))).toBe(1);
  });

  it('returns 0 for an invalid lifetime', () => {
    expect(timeLeftFraction(deadline, created, Date.parse('2026-11-06T00:00:00Z'))).toBe(0);
  });
});

describe('totals', () => {
  it('groups amounts per token and renders mixed tokens', () => {
    expect(totals([
      { amount: '1000000', token: 'T6' },
      { amount: '2000000', token: 'T6' },
      { amount: '500000000', token: 'T7' },
    ], tokens)).toBe('3.00 USD6 + 50.00 XLM');
  });

  it('keeps a zero amount and renders an empty list as zero', () => {
    expect(totals([{ amount: '0', token: 'T6' }], tokens)).toBe('0.00 USD6');
    expect(totals([], tokens)).toBe('0.00');
  });
});

describe('plural', () => {
  it('handles zero, one and many', () => {
    expect(plural(0, 'PR')).toBe('0 PRs');
    expect(plural(1, 'PR')).toBe('1 PR');
    expect(plural(2, 'PR')).toBe('2 PRs');
  });

  it('accepts an irregular plural', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });
});

describe('explorerTx', () => {
  it('uses the default testnet explorer template', () => {
    expect(explorerTx('abc123')).toBe('https://stellar.expert/explorer/testnet/tx/abc123');
  });

  it('URL-encodes the hash', () => {
    expect(explorerTx('a b/c')).toBe('https://stellar.expert/explorer/testnet/tx/a%20b%2Fc');
  });

  it('honours a configured template', () => {
    vi.stubEnv('NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE', 'https://explorer.example/tx/{hash}');
    expect(explorerTx('abc123')).toBe('https://explorer.example/tx/abc123');
  });
});

describe('refundWindow', () => {
  const deadline = '2026-11-02T00:00:00Z';

  it('keeps refund unavailable until the deadline grace period ends', () => {
    expect(refundWindow(deadline, 72 * 3600e3, Date.parse('2026-11-04T00:00:00Z'))).toEqual({ open: false, label: 'Refund available in 24h' });
    expect(refundWindow(deadline, 72 * 3600e3, Date.parse('2026-11-05T00:00:00Z')).open).toBe(true);
  });
});
