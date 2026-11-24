import { describe, expect, it } from 'vitest';
 feat/bounty-metadata-ai-accessibility
import { daysLeft, money, totals } from './api';

import { daysLeft, money, totals, refundWindow } from './api';
 fresh-build

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
  it('keeps refund unavailable until the deadline grace period ends', () => {
    const deadline = '2026-11-02T00:00:00Z';
    expect(refundWindow(deadline, 72 * 3600e3, Date.parse('2026-11-04T00:00:00Z'))).toEqual({ open: false, label: 'Refund available in 1d' });
    expect(refundWindow(deadline, 72 * 3600e3, Date.parse('2026-11-05T00:00:00Z')).open).toBe(true);
  });
});
