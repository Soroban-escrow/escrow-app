// Mirrors contracts/bounty_escrow/src/fees.rs exactly.
export const BPS = 10_000n;
export const MAX_FEE_BPS = 1_000;
const I128_MAX = (1n << 127n) - 1n;

function mulDiv(amount: bigint, bps: number): bigint {
  const p = amount * BigInt(bps);
  if (p > I128_MAX) throw new Error('overflow');
  return p / BPS;
}
export const fee = (amount: bigint, bps: number) => mulDiv(amount, bps);
export const net = (amount: bigint, bps: number) => amount - fee(amount, bps);
export const portion = (amount: bigint, winnerBps: number) => mulDiv(amount, winnerBps);
