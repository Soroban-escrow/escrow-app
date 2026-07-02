import Link from 'next/link';
import { apiGet, daysLeft, money, type BountySummary } from '@/lib/api';

type Search = { sort?: string; q?: string; minAmount?: string; cursor?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ['sort', 'q', 'cursor'] as const) if (sp[k]) qs.set(k, sp[k]!);
  if (sp.minAmount && /^\d+(\.\d{1,7})?$/.test(sp.minAmount)) qs.set('minAmount', String(BigInt(Math.round(Number(sp.minAmount) * 1e7))));
  const data = await apiGet<{ items: BountySummary[]; nextCursor: string | null }>(`/bounties?${qs}`);
  return (
    <>
      <h1>Open bounties</h1>
      <form className="filters" action="/">
        <input name="q" placeholder="Search repo or issue" defaultValue={sp.q} aria-label="Search" />
        <input name="minAmount" inputMode="decimal" placeholder="Min amount" defaultValue={sp.minAmount} aria-label="Minimum amount" />
        <select name="sort" defaultValue={sp.sort ?? 'newest'} aria-label="Sort">
          <option value="newest">Newest</option><option value="highest">Highest</option><option value="ending">Ending soon</option>
        </select>
        <button type="submit">Apply</button><Link href="/">Reset</Link>
      </form>
      {!data ? <p className="error" role="alert">Could not load bounties. Try again shortly.</p>
        : data.items.length === 0 ? <p className="muted">No open bounties match. Maintainers start one by commenting <code>/bounty 50 USDC</code> on an issue.</p>
        : data.items.map((b) => (
          <Link key={b.id} href={`/b/${b.id}`} className="card">
            <div className="row"><strong>{b.issueTitle || `Issue #${b.issueNumber}`}</strong><span className="amount">{money(b.amount, b.token)}</span></div>
            <div className="row muted"><span>{b.repo.fullName}</span><span>{b._count.prs} PRs · {daysLeft(b.deadline)}</span></div>
          </Link>
        ))}
      {data?.nextCursor && <p><Link href={`/?${new URLSearchParams({ ...(sp.sort ? { sort: sp.sort } : {}), cursor: data.nextCursor })}`}>Next page</Link></p>}
    </>
  );
}
