import { describe, expect, it } from 'vitest';
import { clearSessionCookie, sessionCookie } from '../src/auth/github-login.js';
import { COOKIE } from '../src/auth/session.js';

describe('session cookie attributes', () => {
  it('clearSessionCookie mirrors the attributes of sessionCookie across secure and non-secure environments', () => {
    for (const secure of [true, false]) {
      const setCookie = sessionCookie('sample_session_id', 2592000, secure);
      const clearCookie = clearSessionCookie(secure);

      // Verify cookie names and path
      expect(clearCookie.startsWith(`${COOKIE}=; Path=/;`)).toBe(true);
      expect(setCookie.startsWith(`${COOKIE}=sample_session_id; Path=/;`)).toBe(true);

      // Verify clear header sets Max-Age=0
      expect(clearCookie).toContain('Max-Age=0');

      // Verify flags: HttpOnly and SameSite=Lax
      expect(clearCookie).toContain('HttpOnly');
      expect(clearCookie).toContain('SameSite=Lax');

      // Verify Secure attribute mirrors the set header
      expect(clearCookie.includes('Secure')).toBe(setCookie.includes('Secure'));
      if (secure) {
        expect(clearCookie.endsWith('; Secure')).toBe(true);
        expect(setCookie.endsWith('; Secure')).toBe(true);
      } else {
        expect(clearCookie.includes('Secure')).toBe(false);
        expect(setCookie.includes('Secure')).toBe(false);
      }
    }
  });

  it('produces the exact expected cookie strings', () => {
    expect(clearSessionCookie(true)).toBe(`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    expect(clearSessionCookie(false)).toBe(`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  });
});
