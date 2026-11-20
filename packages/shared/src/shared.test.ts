import { describe, expect, it } from 'vitest';
import { fee, fromBaseUnits, net, parseCommand, parseStatus, portion, toBaseUnits } from './index.js';

describe('amounts', () => {
  it('converts both ways', () => {
    expect(toBaseUnits('50.5')).toBe(505000000n);
    expect(toBaseUnits('0.0000001')).toBe(1n);
    expect(fromBaseUnits(505000000n)).toBe('50.5');
    expect(fromBaseUnits(1n)).toBe('0.0000001');
    expect(fromBaseUnits(500000000n, 7, 2)).toBe('50.00');
    expect(fromBaseUnits(0n)).toBe('0');
  });
  it('rejects bad input', () => {
    for (const s of ['', '-1', '1e3', '1.00000001', 'abc', '1.', '.5']) expect(() => toBaseUnits(s)).toThrow();
  });
  it('parses large and fractional user values without floating point rounding', () => {
    expect(toBaseUnits('0.1')).toBe(1_000_000n);
    expect(toBaseUnits('123456789.1234567')).toBe(1_234_567_891_234_567n);
    expect(() => toBaseUnits('1e3')).toThrow();
    expect(() => toBaseUnits('.5')).toThrow();
  });
  it('round-trips', () => {
    for (const v of [0n, 1n, 9999999n, 10000000n, 123456789012345n]) expect(toBaseUnits(fromBaseUnits(v))).toBe(v);
  });
});

describe('fees (same vectors as the contract)', () => {
  it('matches fees.rs tests', () => {
    expect(fee(1n, 300)).toBe(0n);
    expect(net(1n, 300)).toBe(1n);
    expect(fee(1_000_000n, 1)).toBe(100n);
    expect(fee(1_000_000n, 1000)).toBe(100_000n);
    expect(fee(33n, 300)).toBe(0n);
    expect(fee(34n, 300)).toBe(1n);
    expect(portion(3n, 3333)).toBe(0n);
    const i128max = (1n << 127n) - 1n;
    expect(fee(i128max / 10_000n, 10_000)).toBe(i128max / 10_000n);
    expect(() => fee(i128max, 10_000)).toThrow();
  });

  it('preserves the contract fee invariants across generated values', () => {
    let seed = 0x51_7a_11;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % max;
    };
    for (let i = 0; i < 500; i += 1) {
      const amount = BigInt(next(1_000_000_000));
      const bps = next(10_001);
      expect(fee(amount, bps)).toBe((amount * BigInt(bps)) / 10_000n);
      expect(net(amount, bps) + fee(amount, bps)).toBe(amount);
      expect(fee(amount, bps)).toBeLessThanOrEqual(amount);
      expect(portion(amount, bps)).toBe(fee(amount, bps));
    }
  });
});

describe('status', () => {
  it('does not accept prototype keys', () => {
    expect(parseStatus('OPEN')).toBe('OPEN');
    expect(parseStatus('constructor')).toBeUndefined();
  });
});

describe('parseCommand', () => {
  it('parses fund forms', () => {
    expect(parseCommand('/bounty 50 USDC 14d')).toEqual({ kind: 'fund', amount: 500000000n, token: 'USDC', days: 14 });
    expect(parseCommand('  /BOUNTY   5.5  xlm  3D ')).toEqual({ kind: 'fund', amount: 55000000n, token: 'XLM', days: 3 });
    expect(parseCommand('/bounty 10')).toEqual({ kind: 'fund', amount: 100000000n, token: 'USDC', days: 14 });
  });
  it('ignores non-commands and later lines', () => {
    expect(parseCommand('hello\n/bounty 50')).toBeNull();
    expect(parseCommand('/bountyx 50')).toBeNull();
    expect(parseCommand('/bounty 50\nignored text')).toMatchObject({ kind: 'fund' });
  });
  it('reports errors', () => {
    expect(parseCommand('/bounty abc')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/bounty 0')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/bounty 5 DOGE')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/bounty 5 0d')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/bounty dispute')).toMatchObject({ kind: 'error' });
  });
  it('parses dispute, review, help', () => {
    expect(parseCommand('/bounty dispute not paid')).toEqual({ kind: 'dispute', reason: 'not paid' });
    expect(parseCommand('/bounty review')).toEqual({ kind: 'review' });
    expect(parseCommand('/bounty')).toEqual({ kind: 'help' });
    expect(parseCommand('/bounty help')).toEqual({ kind: 'help' });
  });
});
