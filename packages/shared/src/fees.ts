// Mirrors contracts/bounty_escrow/src/fees.rs exactly.
export const BPS = 10_000n;
export const MAX_FEE_BPS = 1_000;
export const I128_MAX = (1n << 127n) - 1n;

function mulDiv(amount: bigint, bps: number | bigint): bigint {
  const b = BigInt(bps);
  if (amount < 0n || b < 0n) throw new Error('negative amount or bps');
  const p = amount * b;
  if (p > I128_MAX) throw new Error('overflow');
  return p / BPS;
}

export const fee = (amount: bigint, bps: number | bigint): bigint => mulDiv(amount, bps);
export const net = (amount: bigint, bps: number | bigint): bigint => amount - fee(amount, bps);
export const portion = (amount: bigint, winnerBps: number | bigint): bigint => mulDiv(amount, winnerBps);
