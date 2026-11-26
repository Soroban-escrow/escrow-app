import Link from 'next/link';
import { apiGet, daysLeft, money, plural, timeLeftFraction, totals, type BountySummary, type TokenInfo } from '@/lib/api';
import { toBaseUnits } from '@skillescrow/shared/src/amounts';

type Search = { sort?: string; q?: string; minAmount?: string; cursor?: string; token?: string; status?: string; repo?: string; history?: string };
type Config = { feeBps: number | null; tokens: TokenInfo[] };
type Filters = { statuses: string[]; tokens: string[]; repositories: string[] };
const mapStatus = (s?: string) => ({ open: 'OPEN', paid: 'RELEASED', refunded: 'REFUNDED', disputed: 'DISPUTED', all: 'ALL' } as Record<string, string>)[s ?? 'open'] ?? 'OPEN';

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [config, filters] = await Promise.all([
    apiGet<Config>('/config'), apiGet<Filters>('/filters'),
  ]);
  const configuredTokens = config?.tokens ?? [];
  // Legacy deployment values remain a fallback while API configuration rolls out.
  const tokens = [...configuredTokens,
    ...(process.env.NEXT_PUBLIC_TOKEN_USDC && !configuredTokens.some((t) => t.address === process.env.NEXT_PUBLIC_TOKEN_USDC) ? [{ address: process.env.NEXT_PUBLIC_TOKEN_USDC, symbol: 'USDC', decimals: 7 }] : []),
    ...(process.env.NEXT_PUBLIC_TOKEN_XLM && !configuredTokens.some((t) => t.address === process.env.NEXT_PUBLIC_TOKEN_XLM) ? [{ address: process.env.NEXT_PUBLIC_TOKEN_XLM, symbol: 'XLM', decimals: 7 }] : []),
  ];
  const availableTokens = [...tokens, ...(filters?.tokens ?? []).filter((address) => !tokens.some((t) => t.address === address)).map((address) => ({ address, symbol: `${address.slice(0, 4)}…`, decimals: -1 }))];
  const selectedToken = tokens.find((t) => t.address === sp.token);
  let amountError: string | null = null;
  let minAmount: string | null = null;
  if (sp.minAmount) {
    try {
      if (!selectedToken) throw new Error('Select a known token to validate the minimum amount.');
      minAmount = toBaseUnits(sp.minAmount, selectedToken.decimals).toString();
    } catch (e) { amountError = e instanceof Error ? e.message : 'Enter a valid amount.'; }
  }
  const qs = new URLSearchParams();
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.q) qs.set('q', sp.q);
  if (sp.token) qs.set('token', sp.token);
  if (sp.repo) qs.set('repo', sp.repo);
  if (sp.status) qs.set('status', mapStatus(sp.status));
  if (sp.cursor) qs.set('cursor', sp.cursor);
  if (minAmount) qs.set('minAmount', minAmount);
  const data = await apiGet<{ items: BountySummary[]; nextCursor: string | null }>(`/bounties?${qs}`);
  const filtered = Boolean(sp.q || sp.minAmount || sp.token || sp.repo || (sp.status && sp.status !== 'open'));
  const items = data?.items ?? [];
  const history = sp.history ? sp.history.split(',').filter(Boolean) : [];
  const hrefForPage = (cursor: string | null, nextHistory: string[]) => {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) if (key !== 'cursor' && key !== 'history' && value) p.set(key, value);
    if (cursor) p.set('cursor', cursor);
    if (sp.minAmount) p.set('minAmount', sp.minAmount);
    if (nextHistory.length) p.set('history', nextHistory.join(','));
    return `/?${p.toString()}`;
  };
  const without = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== key && v) p.set(k, v);
    return `/?${p}`;
  };

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Paid GitHub issues · settled on Stellar</p>
        <h1 className="display">Merge is the <em>approval</em>.</h1>
        <p className="lede">Maintainers lock tokens on an issue. Contributors open a pull request. The one that gets merged is paid from escrow, on-chain, in seconds. No invoices, no chasing.</p>
        {data && !filtered && !sp.cursor && (
          <dl className="stats">
            <div><dt>Open now</dt><dd>{items.length}{data.nextCursor ? '+' : ''}</dd></div>
            <div><dt>{data.nextCursor ? 'In escrow, first page' : 'In escrow'}</dt><dd>{totals(items, tokens)}</dd></div>
            {config?.feeBps !== null && config?.feeBps !== undefined && <div><dt>Fee on payout</dt><dd>{config.feeBps / 100}%</dd></div>}
          </dl>
        )}
      </section>

      <div className="section-head"><h2>Bounties</h2>{data && <span className="mono muted small">{plural(items.length, 'result')}</span>}</div>
      <form className="filters" action="/" role="search">
        <input className="grow" name="q" placeholder="Search a repo or issue" defaultValue={sp.q} aria-label="Search" />
        <input className="narrow" name="minAmount" inputMode="decimal" placeholder="Min amount" defaultValue={sp.minAmount} aria-label="Minimum amount" />
        <select name="token" defaultValue={sp.token ?? ''} aria-label="Token"><option value="">All tokens</option>{availableTokens.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? 'open'} aria-label="Status"><option value="open">Open</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="disputed">Disputed</option><option value="all">All statuses</option></select>
        <select name="repo" defaultValue={sp.repo ?? ''} aria-label="Repository"><option value="">All repositories</option>{(filters?.repositories ?? []).map((repo) => <option key={repo} value={repo}>{repo}</option>)}</select>
        <select name="sort" defaultValue={sp.sort ?? 'newest'} aria-label="Sort"><option value="newest">Newest</option><option value="highest">Highest</option><option value="ending">Ending soon</option></select>
        <button type="submit">Apply</button>
        {(filtered || sp.sort) && <Link href="/">Reset</Link>}
      </form>
      {amountError && <p className="empty error" role="alert">Invalid minimum amount: {amountError}</p>}
      {(sp.q || sp.minAmount || sp.token || sp.repo || (sp.status && sp.status !== 'open')) && <div className="filter-chips" aria-label="Active filters">
        {sp.q && <Link href={without('q')}>Search: {sp.q} ×</Link>}{sp.minAmount && <Link href={without('minAmount')}>Minimum: {sp.minAmount} ×</Link>}
        {sp.token && <Link href={without('token')}>Token: {tokens.find((t) => t.address === sp.token)?.symbol ?? 'Unknown'} ×</Link>}
        {sp.status && sp.status !== 'open' && <Link href={without('status')}>Status: {sp.status} ×</Link>}{sp.repo && <Link href={without('repo')}>Repo: {sp.repo} ×</Link>}
        <Link href="/">Clear all</Link>
      </div>}

      {!data ? <p className="empty error" role="alert">Could not load bounties. Try again in a moment.</p> : items.length === 0 ? (
        <p className="empty">No bounties match these filters. Maintainers start one by commenting <code>/bounty 50 USDC</code> on an issue.</p>
      ) : <ul className="ledger">{items.map((b) => {
        const left = timeLeftFraction(b.createdAt, b.deadline);
        return <li key={b.id}><Link href={`/b/${b.id}`} className="card bounty-row">
          <span><span className="br-repo">{b.repo.fullName} #{b.issueNumber}</span><span className="br-title">{b.issueTitle || `Issue #${b.issueNumber}`}</span><span className="br-meta">{plural(b._count.prs, 'PR')} · {daysLeft(b.deadline)} · {b.status}</span></span>
          <span className="br-amount" title={tokens.some((t) => t.address === b.token) ? undefined : `Unknown token ${b.token}`}>{money(b.amount, b.token, tokens)}</span>
          <span className={`timebar${left < 0.2 ? ' low' : ''}`} aria-hidden="true"><span style={{ width: `${Math.round(left * 100)}%` }} /></span>
        </Link></li>;
      })}</ul>}
      <nav className="pagination" aria-label="Bounty pages">
        {history.length > 0 && (() => { const previous = history.at(-1)!; return <Link className="more" href={hrefForPage(previous === 'first' ? null : previous, history.slice(0, -1))}>← Previous page</Link>; })()}
        {data?.nextCursor && <Link className="more" href={hrefForPage(data.nextCursor, [...history, sp.cursor ?? 'first'])}>Next page →</Link>}
      </nav>
    </>
  );
}
