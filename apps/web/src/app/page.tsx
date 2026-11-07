import Link from 'next/link';
import { apiGetWithMeta, daysLeft, money, plural, timeLeftFraction, totals, type BountySummary } from '@/lib/api';

type Search = { sort?: string; q?: string; minAmount?: string; cursor?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ['sort', 'q', 'cursor'] as const) if (sp[k]) qs.set(k, sp[k]!);
  if (sp.minAmount && /^\d+(\.\d{1,7})?$/.test(sp.minAmount)) qs.set('minAmount', String(BigInt(Math.round(Number(sp.minAmount) * 1e7))));
  const { data, stale } = await apiGetWithMeta<{ items: BountySummary[]; nextCursor: string | null }>(`/bounties?${qs}`);
  const filtered = Boolean(sp.q || sp.minAmount);
  const items = data?.items ?? [];

  return (
    <>
      {stale && (
        <p className="notice" role="note">
          Data may be out of date — showing last cached snapshot while the API reconnects.
        </p>
      )}
      <section className="hero">
        <p className="eyebrow">Paid GitHub issues · settled on Stellar</p>
        <h1 className="display">Merge is the <em>approval</em>.</h1>
        <p className="lede">
          Maintainers lock USDC on an issue. Contributors open a pull request. The one that gets merged is paid
          from escrow, on-chain, in seconds. No invoices, no chasing.
        </p>
        {data && !filtered && !sp.cursor && (
          <dl className="stats">
            <div><dt>Open now</dt><dd>{items.length}{data.nextCursor ? '+' : ''}</dd></div>
            <div><dt>{data.nextCursor ? 'In escrow, first page' : 'In escrow'}</dt><dd>{totals(items)}</dd></div>
            <div><dt>Fee on payout</dt><dd>3%</dd></div>
          </dl>
        )}
      </section>

      <div className="section-head">
        <h2>Open bounties</h2>
        {data && <span className="mono muted small">{plural(items.length, 'result')}</span>}
      </div>

      <form className="filters" action="/" role="search">
        <input className="grow" name="q" placeholder="Search a repo or issue" defaultValue={sp.q} aria-label="Search" />
        <input className="narrow" name="minAmount" inputMode="decimal" placeholder="Min amount" defaultValue={sp.minAmount} aria-label="Minimum amount" />
        <select name="sort" defaultValue={sp.sort ?? 'newest'} aria-label="Sort">
          <option value="newest">Newest</option><option value="highest">Highest</option><option value="ending">Ending soon</option>
        </select>
        <button type="submit">Apply</button>
        {(filtered || sp.sort) && <Link href="/">Reset</Link>}
      </form>

      {!data ? (
        <p className="empty error" role="alert">Could not load bounties. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <p className="empty">No open bounties match. Maintainers start one by commenting <code>/bounty 50 USDC</code> on an issue.</p>
      ) : (
        <ul className="ledger">
          {items.map((b) => {
            const left = timeLeftFraction(b.createdAt, b.deadline);
            return (
              <li key={b.id}>
                <Link href={`/b/${b.id}`} className="card bounty-row">
                  <span>
                    <span className="br-repo">{b.repo.fullName} #{b.issueNumber}</span>
                    <span className="br-title">{b.issueTitle || `Issue #${b.issueNumber}`}</span>
                    <span className="br-meta">{plural(b._count.prs, 'PR')} · {daysLeft(b.deadline)}</span>
                  </span>
                  <span className="br-amount">{money(b.amount, b.token)}</span>
                  <span className={`timebar${left < 0.2 ? ' low' : ''}`} aria-hidden="true"><span style={{ width: `${Math.round(left * 100)}%` }} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data?.nextCursor && <Link className="more" href={`/?${new URLSearchParams({ ...(sp.sort ? { sort: sp.sort } : {}), cursor: data.nextCursor })}`}>Next page →</Link>}
    </>
  );
}
