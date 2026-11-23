export const TOKEN_DECIMALS = 7;

/** "50.5" -> 505000000n. Rejects anything that is not an exact non-negative decimal. */
export function toBaseUnits(s: string, decimals = TOKEN_DECIMALS): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`invalid amount: ${s}`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) throw new Error(`too many decimals: ${s}`);
  return BigInt(m[1]! + frac.padEnd(decimals, '0'));
}

/** 505000000n -> "50.5" (trailing zeros trimmed, at least `minFrac` places). */
export function fromBaseUnits(v: bigint, decimals = TOKEN_DECIMALS, minFrac = 0): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).replace(/0+$/, '');
  frac = frac.padEnd(minFrac, '0');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}
