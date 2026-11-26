import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getCookie, parseCookies } from '../src/auth/cookies.js';
import { userKey } from '../src/routes/limits.js';

const plain = (header: string) => ({ ...parseCookies(header) });

describe('parseCookies (#163)', () => {
  it('splits each pair on the first = only, keeping = inside values', () => {
    expect(plain('state=YWJj==; se_session=abc')).toEqual({ state: 'YWJj==', se_session: 'abc' });
    expect(getCookie('third=a=b=c', 'third')).toBe('a=b=c');
  });

  it('keeps empty values and ignores pairs without =', () => {
    expect(plain('empty=; flag; other=1')).toEqual({ empty: '', other: '1' });
    expect(getCookie('empty=', 'empty')).toBe('');
    expect(getCookie('flag', 'flag')).toBeUndefined();
  });

  it('lets the first of duplicate names win, so a later one cannot shadow the session', () => {
    expect(getCookie('se_session=real; se_session=evil', 'se_session')).toBe('real');
  });

  it('ignores whitespace around separators, names and values', () => {
    expect(plain('  a = 1 ;b=2;   c=  3  ;  ')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('URL-decodes values and strips one pair of surrounding quotes', () => {
    expect(getCookie('next=%2Fb%2F42%3Ftab%3Dprs', 'next')).toBe('/b/42?tab=prs');
    expect(getCookie('q="hello%20world"', 'q')).toBe('hello world');
    // A malformed escape keeps the raw value rather than throwing.
    expect(getCookie('bad=%E0%A4%A', 'bad')).toBe('%E0%A4%A');
  });

  it('skips names that are not RFC 6265 tokens instead of mis-attributing them', () => {
    expect(plain('se session=evil; se,session=evil; =novalue; se_session=ok')).toEqual({ se_session: 'ok' });
  });

  it('treats __proto__ as an ordinary name without polluting prototypes', () => {
    const parsed = parseCookies('__proto__=x; a=1');
    expect(parsed['__proto__']).toBe('x');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});

describe('userKey uses the shared cookie helper (#163)', () => {
  const sid = 'a'.repeat(64);
  const req = (cookie: string | undefined) => ({ headers: { cookie }, ip: '203.0.113.7' }) as unknown as FastifyRequest;

  it('keys by session when se_session is a session id, wherever it sits in the header', () => {
    const key = userKey(req(`se_session=${sid}`));
    expect(key).toMatch(/^u:[0-9a-f]{16}$/);
    expect(userKey(req(`other=x=y; se_session=${sid}`))).toBe(key);
    expect(userKey(req(`  se_session = ${sid} ;theme=dark`))).toBe(key);
  });

  it('agrees with the API on which se_session counts: the first one', () => {
    expect(userKey(req(`se_session=${sid}; se_session=${'b'.repeat(64)}`))).toBe(userKey(req(`se_session=${sid}`)));
  });

  it('falls back to the IP when there is no valid session cookie', () => {
    expect(userKey(req(undefined))).toBe('ip:203.0.113.7');
    expect(userKey(req('se_session=not-a-session'))).toBe('ip:203.0.113.7');
    expect(userKey(req(`xse_session=${sid}`))).toBe('ip:203.0.113.7');
  });
});
