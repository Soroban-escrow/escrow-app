/**
 * Parse a Cookie header into a key-value record.
 *
 * - Splits each pair on the first '=' only so values containing '=' (such as base64 padding) are preserved.
 * - Trims whitespace from both keys and values.
 * - Safely URL-decodes cookie values.
 * - Ignores empty or malformed entries without an '=' so they cannot shadow valid cookies.
 * - Retains first cookie seen when duplicate names appear (RFC 6265 §5.4).
 */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue; // no '=' or empty key
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;
    // Retain first occurrence if duplicate cookie names exist
    if (key in cookies) continue;

    const rawVal = trimmed.slice(eqIdx + 1).trim();
    const unquoted = rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2
      ? rawVal.slice(1, -1)
      : rawVal;

    try {
      cookies[key] = decodeURIComponent(unquoted);
    } catch {
      cookies[key] = unquoted;
    }
  }
  return cookies;
}
