/**
 * Cookie header parsing shared by the API routes and the rate limiter (#163).
 *
 * Follows RFC 6265 §5.4 as browsers send it:
 * - pairs are separated by `;`, surrounding whitespace is ignored;
 * - each pair is split on its FIRST `=`, so values may contain `=`
 *   (base64 padding, third-party cookies on the same domain);
 * - values are URL-decoded (a malformed encoding keeps the raw value) and
 *   one pair of surrounding double quotes is removed;
 * - a pair with no `=` or with a name that is not an RFC 6265 token is
 *   ignored, so a malformed name can never be read as another cookie;
 * - when a name repeats, the FIRST occurrence wins (browsers send the most
 *   specific path first), so a later duplicate cannot shadow `se_session`.
 */

// RFC 6265 cookie-name = token (RFC 2616): visible ASCII except separators.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function decode(raw: string): string {
  const unquoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

/** All cookies in a `Cookie` header. The result has no prototype, so names like `__proto__` are plain keys. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!TOKEN.test(name) || name in out) continue;
    out[name] = decode(part.slice(eq + 1).trim());
  }
  return out;
}

/** One cookie's value, or undefined when it is absent. */
export function getCookie(header: string | undefined | null, name: string): string | undefined {
  return parseCookies(header)[name];
}
