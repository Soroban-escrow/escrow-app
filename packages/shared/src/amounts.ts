export const TOKEN_DECIMALS = 7;

/**
 * Converts a decimal string representation to base units (e.g. "50.5" -> 505000000n).
 * Rejects anything that is not an exact non-negative decimal string (rejects signs, exponents, spaces, unicode digits, multiple dots, and excess precision).
 */
export function toBaseUnits(s: string, decimals = TOKEN_DECIMALS): bigint {
  if (typeof s !== 'string') throw new Error(`invalid amount: ${s}`);
  // Strictly allow non-negative ASCII digits only, optional dot and decimal digits
  const m = /^[0-9]+(?:\.[0-9]+)?$/.exec(s);
  if (!m) throw new Error(`invalid amount: ${s}`);

  const dotIndex = s.indexOf('.');
  const intPart = dotIndex === -1 ? s : s.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : s.slice(dotIndex + 1);

  if (fracPart.length > decimals) {
    throw new Error(`too many decimals: ${s}`);
  }

  return BigInt(intPart + fracPart.padEnd(decimals, '0'));
}

/**
 * Converts base units back to decimal string (e.g. 505000000n -> "50.5").
 * Trailing zeros are trimmed, leaving at least `minFrac` places.
 */
export function fromBaseUnits(v: bigint, decimals = TOKEN_DECIMALS, minFrac = 0): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).replace(/0+$/, '');
  frac = frac.padEnd(minFrac, '0');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}

/**
 * Normalises a valid decimal string to canonical form:
 * - Strips leading zeros from the integer part (except a solitary "0")
 * - Strips redundant trailing zeros from the fractional part (omitting decimal point if empty)
 */
export function normalise(s: string): string {
  if (typeof s !== 'string') throw new Error(`invalid amount: ${s}`);
  const m = /^[0-9]+(?:\.[0-9]+)?$/.exec(s);
  if (!m) throw new Error(`invalid amount: ${s}`);

  const dotIndex = s.indexOf('.');
  const intPart = dotIndex === -1 ? s : s.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : s.slice(dotIndex + 1);

  const cleanInt = BigInt(intPart).toString();
  const cleanFrac = fracPart.replace(/0+$/, '');
  return cleanFrac ? `${cleanInt}.${cleanFrac}` : cleanInt;
}
