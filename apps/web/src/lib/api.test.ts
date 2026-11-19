import { describe, expect, it } from 'vitest';
import { daysLeft, money, totals } from './api';

describe('formatting', () => {
  it('uses API token precision and never guesses precision for an unknown token', () => {
    const tokens = [{ address: 'T6', symbol: 'USD6', decimals: 6 }, { address: 'T7', symbol: 'XLM', decimals: 7 }, { address: 'T18', symbol: 'EVM', decimals: 18 }];
    expect(money('1234567', 'T6', tokens)).toBe('1.234567 USD6');
    expect(money('500000000', 'T7', tokens)).toBe('50.00 XLM');
    expect(money('1234567890123456789', 'T18', tokens)).toBe('1.234567890123456789 EVM');
    expect(money('500000000', 'CABCDEF', tokens)).toBe('500000000 CABC… (unknown token)');
    expect(totals([{ amount: '1000000', token: 'T6' }], tokens)).toBe('1.00 USD6');
  });
  it('formats time left', () => {
    const now = Date.parse('2026-11-02T00:00:00Z');
    expect(daysLeft('2026-11-05T00:00:00Z', now)).toBe('3d left');
    expect(daysLeft('2026-11-02T05:00:00Z', now)).toBe('5h left');
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe('deadline passed');
  });
});
