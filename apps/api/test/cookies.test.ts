import { describe, expect, it } from 'vitest';
import { parseCookies } from '../src/routes/cookies.js';
import { userKey } from '../src/routes/limits.js';
import { COOKIE } from '../src/auth/session.js';
import type { FastifyRequest } from 'fastify';

describe('parseCookies', () => {
  it('parses single and multiple standard key-value cookies', () => {
    expect(parseCookies('foo=bar')).toEqual({ foo: 'bar' });
    expect(parseCookies('a=1; b=2; c=hello')).toEqual({ a: '1', b: '2', c: 'hello' });
  });

  it('preserves values containing = characters (such as base64 padding or query strings)', () => {
    const header = 'token=abc=def==; session=xyz===; eq=1=2=3=4';
    const parsed = parseCookies(header);
    expect(parsed.token).toBe('abc=def==');
    expect(parsed.session).toBe('xyz===');
    expect(parsed.eq).toBe('1=2=3=4');
  });

  it('handles empty values and quoted empty values properly', () => {
    const header = 'empty=; spaced=   ; quoted=""; normal=123';
    const parsed = parseCookies(header);
    expect(parsed.empty).toBe('');
    expect(parsed.spaced).toBe('');
    expect(parsed.quoted).toBe('');
    expect(parsed.normal).toBe('123');
  });

  it('honors first-seen for duplicate cookie names to prevent shadowing', () => {
    const header = 'se_session=first_valid_value; se_session=second_shadow_attempt; foo=1; foo=2';
    const parsed = parseCookies(header);
    expect(parsed.se_session).toBe('first_valid_value');
    expect(parsed.foo).toBe('1');
  });

  it('handles and trims arbitrary whitespace around keys, values, and separators', () => {
    const header = '   a   =   val1   ;   b = val2   ; c=val3 ';
    const parsed = parseCookies(header);
    expect(parsed).toEqual({ a: 'val1', b: 'val2', c: 'val3' });
  });

  it('ignores malformed entries missing an equals sign so valid cookies are not affected', () => {
    const header = 'malformed_without_eq; se_session=valid_session_123; another_malformed; flag=true';
    const parsed = parseCookies(header);
    expect(parsed.se_session).toBe('valid_session_123');
    expect(parsed.flag).toBe('true');
    expect(parsed.malformed_without_eq).toBeUndefined();
    expect(parsed.another_malformed).toBeUndefined();
  });

  it('ignores entries with empty key before equals sign', () => {
    const header = '=value_with_no_key; valid=ok; =another';
    const parsed = parseCookies(header);
    expect(parsed.valid).toBe('ok');
    expect(parsed['']).toBeUndefined();
  });

  it('URL-decodes cookie values safely', () => {
    const header = 'greeting=hello%20world; encoded_eq=key%3Dvalue; raw=%E2%9C%93';
    const parsed = parseCookies(header);
    expect(parsed.greeting).toBe('hello world');
    expect(parsed.encoded_eq).toBe('key=value');
    expect(parsed.raw).toBe('✓');
  });

  it('handles unescaped or malformed percent-encoding gracefully without crashing', () => {
    const header = 'bad_pct=%ZZ%1; good=ok';
    const parsed = parseCookies(header);
    expect(parsed.bad_pct).toBe('%ZZ%1');
    expect(parsed.good).toBe('ok');
  });

  it('unquotes double-quoted values', () => {
    const header = 'quoted="quoted value here"; unquoted=raw';
    const parsed = parseCookies(header);
    expect(parsed.quoted).toBe('quoted value here');
    expect(parsed.unquoted).toBe('raw');
  });

  it('returns an empty object for empty, null, or undefined headers', () => {
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies('   ;  ;;  ; ')).toEqual({});
  });
});

describe('userKey with shared cookie helper', () => {
  it('derives a user rate-limit key from valid 64-char session ID in cookie', () => {
    const validSid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const req = {
      headers: { cookie: `${COOKIE}=${validSid}` },
      ip: '127.0.0.1',
    } as unknown as FastifyRequest;

    const key = userKey(req);
    expect(key.startsWith('u:')).toBe(true);
    expect(key.length).toBe(18); // 'u:' + 16 hex chars
  });

  it('falls back to IP when session ID is missing or malformed', () => {
    const reqWithoutCookie = {
      headers: {},
      ip: '192.168.1.1',
    } as unknown as FastifyRequest;
    expect(userKey(reqWithoutCookie)).toBe('ip:192.168.1.1');

    const reqWithInvalidSid = {
      headers: { cookie: `${COOKIE}=not_64_chars; other=abc=def==` },
      ip: '192.168.1.1',
    } as unknown as FastifyRequest;
    expect(userKey(reqWithInvalidSid)).toBe('ip:192.168.1.1');
  });

  it('extracts valid session even when cookies contain values with = and complex padding', () => {
    const validSid = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const req = {
      headers: {
        cookie: `third_party=base64==token==; ${COOKIE}=${validSid}; other=1=2=3`,
      },
      ip: '10.0.0.1',
    } as unknown as FastifyRequest;

    const key = userKey(req);
    expect(key.startsWith('u:')).toBe(true);
  });
});
