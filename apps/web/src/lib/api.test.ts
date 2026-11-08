import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, daysLeft, money } from './api';

describe('apiGet error discrimination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok: true with parsed data on HTTP 200', async () => {
    const mockData = { id: '1', title: 'Test Bounty' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as unknown as Response);

    const res = await apiGet<typeof mockData>('/bounties/1');
    expect(res).toEqual({
      ok: true,
      data: mockData,
    });
  });

  it('returns ok: false with kind not_found on HTTP 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as unknown as Response);

    const res = await apiGet('/bounties/999');
    expect(res).toEqual({
      ok: false,
      kind: 'not_found',
      status: 404,
    });
  });

  it('returns ok: false with kind unavailable on HTTP 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal error' }),
    } as unknown as Response);

    const res = await apiGet('/bounties/1');
    expect(res).toEqual({
      ok: false,
      kind: 'unavailable',
      status: 500,
    });
  });

  it('returns ok: false with kind unavailable on network failure or DNS error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const res = await apiGet('/bounties/1');
    expect(res).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('returns ok: false with kind unavailable on timeout abort', async () => {
    const abortErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortErr);

    const res = await apiGet('/bounties/1', { timeoutMs: 10 });
    expect(res).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('returns ok: false with kind invalid on non-JSON response payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    } as unknown as Response);

    const res = await apiGet('/bounties/1');
    expect(res).toEqual({
      ok: false,
      kind: 'invalid',
      status: 200,
    });
  });
});

describe('formatting', () => {
  it('formats money with two decimals and unknown tokens shortened', () => {
    expect(money('500000000', 'CABCDEF')).toBe('50.00 CABC…');
    expect(money('1', 'CABCDEF')).toBe('0.0000001 CABC…');
  });

  it('formats time left', () => {
    const now = Date.parse('2026-11-02T00:00:00Z');
    expect(daysLeft('2026-11-05T00:00:00Z', now)).toBe('3d left');
    expect(daysLeft('2026-11-02T05:00:00Z', now)).toBe('5h left');
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe('deadline passed');
  });
});
