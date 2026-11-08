import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBountyMetadata, buildProfileMetadata, escapeMarkup, truncateText } from './metadata';
import robots from '../app/robots';
import sitemap from '../app/sitemap';

describe('metadata utility functions', () => {
  it('escapes HTML markup characters to prevent XSS in social meta tags', () => {
    expect(escapeMarkup('<script>alert("xss")</script>Fix issue')).toBe('scriptalert("xss")/scriptFix issue');
    expect(escapeMarkup('Support <Button> and <Select>')).toBe('Support Button and Select');
  });

  it('truncates extremely long strings cleanly with ellipsis', () => {
    const long = 'A'.repeat(200);
    const truncated = truncateText(long, 50);
    expect(truncated.length).toBe(50);
    expect(truncated.endsWith('…')).toBe(true);
  });
});

describe('dynamic metadata builders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds dynamic bounty metadata for open active bounty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'b-101',
        issueNumber: 42,
        issueTitle: 'Add WebSocket streaming for real-time orderbook',
        amount: '1500000000',
        token: 'CUSDC123',
        status: 'OPEN',
        deadline: '2026-12-01T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
        repo: { fullName: 'stellar/soroban-dex' },
        prs: [],
        payouts: [],
      }),
    } as unknown as Response);

    const meta = await buildBountyMetadata('b-101');
    expect(meta.title).toContain('150.00');
    expect(meta.title).toContain('Add WebSocket streaming for real-time orderbook');
    expect(meta.title).toContain('stellar/soroban-dex #42');
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph?.title).toContain('150.00');
  });

  it('truncates extreme long issue titles in buildBountyMetadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'b-999',
        issueNumber: 99,
        issueTitle: 'Super long title '.repeat(50),
        amount: '1000000000',
        token: 'CUSDC123',
        status: 'OPEN',
        deadline: '2026-12-01T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
        repo: { fullName: 'stellar/soroban-dex' },
        prs: [],
        payouts: [],
      }),
    } as unknown as Response);

    const meta = await buildBountyMetadata('b-999');
    const titleStr = String(meta.title);
    expect(titleStr.length).toBeLessThan(160);
    expect(titleStr).toContain('…');
  });

  it('sets noindex for terminal/settled bounties', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'b-102',
        issueNumber: 43,
        issueTitle: 'Fix memory leak',
        amount: '500000000',
        token: 'CUSDC123',
        status: 'RELEASED',
        deadline: '2026-11-05T00:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
        repo: { fullName: 'stellar/soroban-dex' },
        prs: [],
        payouts: [],
      }),
    } as unknown as Response);

    const meta = await buildBountyMetadata('b-102');
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('handles missing bounty gracefully with fallback metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as unknown as Response);

    const meta = await buildBountyMetadata('missing-bounty');
    expect(meta.title).toBe('Bounty Not Found · SkillEscrow');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('builds contributor profile metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        login: 'kenway009',
        paid: [],
      }),
    } as unknown as Response);

    const meta = await buildProfileMetadata('kenway009');
    expect(meta.title).toBe("kenway009's Contributor Profile · SkillEscrow");
    expect(meta.openGraph?.title).toContain('kenway009');
  });
});

describe('SEO discovery routes: robots.txt and sitemap.xml', () => {
  it('robots() contains /fund/* disallow pattern and points to sitemap', () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;
    expect(rules).toBeDefined();
    if (rules && 'disallow' in rules) {
      expect(rules.disallow).toContain('/me');
      expect(rules.disallow).toContain('/admin');
      expect(rules.disallow).toContain('/fund/');
      expect(rules.disallow).toContain('/fund/*');
    }
    expect(config.sitemap).toContain('sitemap.xml');
  });

  it('sitemap() generates valid route array including static and open bounties', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'b-1',
            createdAt: '2026-11-01T00:00:00Z',
          },
        ],
      }),
    } as unknown as Response);

    const map = await sitemap();
    const urls = map.map((r) => r.url);
    expect(urls.some((u) => u.endsWith('/docs'))).toBe(true);
    expect(urls.some((u) => u.includes('/b/b-1'))).toBe(true);
    expect(urls.some((u) => u.includes('/me'))).toBe(false);
    expect(urls.some((u) => u.includes('/admin'))).toBe(false);
  });
});
