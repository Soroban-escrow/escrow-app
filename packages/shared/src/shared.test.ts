import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BPS,
  I128_MAX,
  MAX_FEE_BPS,
  TOKEN_DECIMALS,
  fee,
  fromBaseUnits,
  net,
  normalise,
  parseCommand,
  parseStatus,
  portion,
  toBaseUnits,
} from './index.js';
import canonicalVectors from './fee-vectors.json' with { type: 'json' };

const digitChar = fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');
const digitString = (min: number, max: number) =>
  fc.array(digitChar, { minLength: min, maxLength: max }).map((arr) => arr.join(''));

describe('amounts (deterministic & boundary unit tests)', () => {
  it('converts both ways for standard test cases', () => {
    expect(toBaseUnits('50.5')).toBe(505000000n);
    expect(toBaseUnits('0.0000001')).toBe(1n);
    expect(fromBaseUnits(505000000n)).toBe('50.5');
    expect(fromBaseUnits(1n)).toBe('0.0000001');
    expect(fromBaseUnits(500000000n, 7, 2)).toBe('50.00');
    expect(fromBaseUnits(0n)).toBe('0');
  });

  it('rejects malformed inputs', () => {
    const malformed = [
      '',
      '-1',
      '+1',
      '1e3',
      '1E-5',
      '1.00000001',
      'abc',
      '1.',
      '.5',
      ' 50.5',
      '50.5 ',
      '5 0',
      '1.2.3',
      '५०.५', // Devanagari unicode digits
      '٥٠.٥', // Arabic-Indic unicode digits
    ];
    for (const s of malformed) {
      expect(() => toBaseUnits(s)).toThrow();
    }
  });

  it('round-trips standard integer values', () => {
    for (const v of [0n, 1n, 9999999n, 10000000n, 123456789012345n]) {
      expect(toBaseUnits(fromBaseUnits(v))).toBe(v);
    }
  });

  it('normalise helper formats canonical decimal representation', () => {
    expect(normalise('050.500')).toBe('50.5');
    expect(normalise('0.0000000')).toBe('0');
    expect(normalise('00.00')).toBe('0');
    expect(normalise('100.0000000')).toBe('100');
    expect(normalise('007.120')).toBe('7.12');
  });
});

describe('fee-vectors.json (canonical shared vectors)', () => {
  it('matches all fee vectors in fee-vectors.json', () => {
    for (const vec of canonicalVectors.fee_vectors) {
      const amount = BigInt(vec.amount);
      const bps = vec.bps;
      if (vec.overflow) {
        expect(() => fee(amount, bps), `expected overflow for ${vec.description}`).toThrow(/overflow/);
      } else {
        const actualFee = fee(amount, bps);
        const actualNet = net(amount, bps);
        expect(actualFee, vec.description).toBe(BigInt(vec.expected_fee!));
        expect(actualNet, vec.description).toBe(BigInt(vec.expected_net!));
        expect(actualNet + actualFee, `net + fee must equal amount for ${vec.description}`).toBe(amount);
      }
    }
  });

  it('matches all portion vectors in fee-vectors.json', () => {
    for (const vec of canonicalVectors.portion_vectors) {
      const amount = BigInt(vec.amount);
      const actualPortion = portion(amount, vec.bps);
      expect(actualPortion, vec.description).toBe(BigInt(vec.expected_portion));
    }
  });

  it('matches all amount vectors in fee-vectors.json', () => {
    for (const vec of canonicalVectors.amount_vectors) {
      const base = toBaseUnits(vec.raw, vec.decimals);
      expect(base).toBe(BigInt(vec.expected_base));
      expect(normalise(vec.raw)).toBe(vec.normalised);
      expect(fromBaseUnits(base, vec.decimals)).toBe(vec.normalised);
    }
  });
});

describe('fast-check property tests (amount parsing & normalisation)', () => {
  it('property: fromBaseUnits(toBaseUnits(x)) === normalise(x) for arbitrary decimals up to 7 places', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        digitString(0, TOKEN_DECIMALS),
        (intPart, fracPart) => {
          const raw = fracPart.length > 0 ? `${intPart}.${fracPart}` : `${intPart}`;
          const base = toBaseUnits(raw);
          const roundTrip = fromBaseUnits(base);
          const expectedNormal = normalise(raw);
          expect(roundTrip).toBe(expectedNormal);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('property: rejects strings with too many decimal places (> TOKEN_DECIMALS)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000 }),
        digitString(TOKEN_DECIMALS + 1, TOKEN_DECIMALS + 10),
        (intPart, excessFrac) => {
          const raw = `${intPart}.${excessFrac}`;
          expect(() => toBaseUnits(raw)).toThrow(/too many decimals/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: rejects malformed strings (whitespace, signs, exponents, multiple dots)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), (n) => {
        // Leading or trailing space
        expect(() => toBaseUnits(` ${n}`)).toThrow(/invalid amount/);
        expect(() => toBaseUnits(`${n} `)).toThrow(/invalid amount/);
        // Explicit positive or negative sign
        expect(() => toBaseUnits(`+${n}`)).toThrow(/invalid amount/);
        expect(() => toBaseUnits(`-${n}`)).toThrow(/invalid amount/);
        // Exponent notation
        expect(() => toBaseUnits(`${n}e2`)).toThrow(/invalid amount/);
        expect(() => toBaseUnits(`${n}E-1`)).toThrow(/invalid amount/);
        // Multiple dots
        expect(() => toBaseUnits(`${n}.1.2`)).toThrow(/invalid amount/);
      }),
      { numRuns: 100 }
    );
  });
});

describe('fast-check property tests (fees mathematical invariants)', () => {
  const safeAmountArbitrary = fc.bigInt({ min: 0n, max: I128_MAX / 10_000n });
  const bpsArbitrary = fc.integer({ min: 0, max: 10_000 });

  it('property: net + fee === amount for arbitrary non-negative amount and bps', () => {
    fc.assert(
      fc.property(safeAmountArbitrary, bpsArbitrary, (amount, bps) => {
        const f = fee(amount, bps);
        const n = net(amount, bps);
        expect(n + f).toBe(amount);
      }),
      { numRuns: 300 }
    );
  });

  it('property: monotonicity (amountA <= amountB implies fee(amountA) <= fee(amountB))', () => {
    fc.assert(
      fc.property(safeAmountArbitrary, safeAmountArbitrary, bpsArbitrary, (a, b, bps) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(fee(low, bps)).toBeLessThanOrEqual(fee(high, bps));
        expect(portion(low, bps)).toBeLessThanOrEqual(portion(high, bps));
      }),
      { numRuns: 300 }
    );
  });

  it('property: fee boundedness (0 <= fee <= amount for 0 <= bps <= 10_000)', () => {
    fc.assert(
      fc.property(safeAmountArbitrary, bpsArbitrary, (amount, bps) => {
        const f = fee(amount, bps);
        expect(f).toBeGreaterThanOrEqual(0n);
        expect(f).toBeLessThanOrEqual(amount);
      }),
      { numRuns: 300 }
    );
  });
});

describe('large values & i128 checked arithmetic cutoffs', () => {
  it('computes exact boundary for i128::MAX / 10_000n without overflow', () => {
    const boundary = I128_MAX / 10_000n;
    expect(fee(boundary, 10_000)).toBe(boundary);
    expect(net(boundary, 10_000)).toBe(0n);
  });

  it('throws overflow immediately when amount * bps exceeds i128::MAX', () => {
    const aboveBoundary = I128_MAX / 10_000n + 1n;
    expect(() => fee(aboveBoundary, 10_000)).toThrow(/overflow/);
    expect(() => fee(I128_MAX, 10_000)).toThrow(/overflow/);
    // Boundary with 1 bps: I128_MAX * 1n <= I128_MAX (succeeds)
    expect(fee(I128_MAX, 1)).toBe(I128_MAX / 10_000n);
    // Boundary with 2 bps: I128_MAX * 2n > I128_MAX (overflows)
    expect(() => fee(I128_MAX, 2)).toThrow(/overflow/);
  });
});

describe('mutation testing (floor division vs round-to-nearest)', () => {
  // Simulates a mutation where rounding is changed from floor (truncate) to round-to-nearest
  function mutatedRoundFee(amount: bigint, bps: number): bigint {
    return (amount * BigInt(bps) + BPS / 2n) / BPS;
  }

  function mutatedRoundPortion(amount: bigint, winnerBps: number): bigint {
    return (amount * BigInt(winnerBps) + BPS / 2n) / BPS;
  }

  it('mutation is caught by at least two independent tests/vectors', () => {
    let caughtCount = 0;

    // Test vector 1: 33 units at 300 bps (33 * 300 = 9900 < 10000; floor=0, round=1)
    const canonicalFee1 = fee(33n, 300);
    const mutatedFee1 = mutatedRoundFee(33n, 300);
    if (canonicalFee1 !== mutatedFee1) {
      caughtCount++;
    }
    expect(canonicalFee1).toBe(0n);
    expect(mutatedFee1).toBe(1n);

    // Test vector 2: portion for 3 units at 3333 bps (3 * 3333 = 9999 < 10000; floor=0, round=1)
    const canonicalPortion = portion(3n, 3333);
    const mutatedPortion = mutatedRoundPortion(3n, 3333);
    if (canonicalPortion !== mutatedPortion) {
      caughtCount++;
    }
    expect(canonicalPortion).toBe(0n);
    expect(mutatedPortion).toBe(1n);

    // Test vector 3: 17 units at 300 bps (17 * 300 = 5100; floor=0, round=1)
    const canonicalFee2 = fee(17n, 300);
    const mutatedFee2 = mutatedRoundFee(17n, 300);
    if (canonicalFee2 !== mutatedFee2) {
      caughtCount++;
    }
    expect(canonicalFee2).toBe(0n);
    expect(mutatedFee2).toBe(1n);

    expect(caughtCount).toBeGreaterThanOrEqual(2);
  });
});

describe('status parser (regression check)', () => {
  it('does not accept prototype keys', () => {
    expect(parseStatus('OPEN')).toBe('OPEN');
    expect(parseStatus('constructor')).toBeUndefined();
  });
});

describe('parseCommand (regression check)', () => {
  it('parses fund forms', () => {
    expect(parseCommand('/bounty 50 USDC 14d')).toEqual({
      kind: 'fund',
      amount: 500000000n,
      token: 'USDC',
      days: 14,
    });
    expect(parseCommand('  /BOUNTY   5.5  xlm  3D ')).toEqual({
      kind: 'fund',
      amount: 55000000n,
      token: 'XLM',
      days: 3,
    });
    expect(parseCommand('/bounty 10')).toEqual({
      kind: 'fund',
      amount: 100000000n,
      token: 'USDC',
      days: 14,
    });
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
    expect(parseCommand('/bounty dispute not paid')).toEqual({
      kind: 'dispute',
      reason: 'not paid',
    });
    expect(parseCommand('/bounty review')).toEqual({ kind: 'review' });
    expect(parseCommand('/bounty')).toEqual({ kind: 'help' });
    expect(parseCommand('/bounty help')).toEqual({ kind: 'help' });
  });
});
