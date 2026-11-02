import { notFound } from 'next/navigation';
import { apiGet, daysLeft, explorerTx, money } from '@/lib/api';

interface Detail {
  id: string; issueNumber: number; issueTitle: string; issueUrl: string; amount: string; token: string; status: string; deadline: string; maintainer: string;
  criteria: string[]; relayerAllowed: boolean; repo: { fullName: string };
  prs: { id: string; number: number; authorLogin: string; state: string; reviews: { verdict: string; score: number; flags: string[] }[] }[];
  payouts: { status: string; prNumber: number; txHash: string | null }[];
}

const VERDICT: Record<string, string> = { likely_meets: 'Likely meets', partially_meets: 'Partially meets', does_not_meet: 'Does not meet', needs_human: 'Needs a human' };
const ORDER = ['likely_meets', 'partially_meets', 'does_not_meet', 'needs_human'];

export default async function Bounty({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await apiGet<Detail>(`/bounties/${encodeURIComponent(id)}`);
  if (!b) notFound();
  const prs = [...b.prs].sort((x, y) => {
    const rx = x.reviews[0], ry = y.reviews[0];
    return (ORDER.indexOf(rx?.verdict ?? 'needs_human') - ORDER.indexOf(ry?.verdict ?? 'needs_human')) || ((ry?.score ?? 0) - (rx?.score ?? 0));
  });
  return (
    <>
      <h1>{b.issueTitle || 'Bounty'}</h1>
      <p className="muted">{b.repo.fullName} · <span className="badge">{b.status}</span> · {daysLeft(b.deadline)}</p>
      <p><span className="amount">{money(b.amount, b.token)}</span> · release on merge: {b.relayerAllowed ? 'automatic' : 'maintainer signs'}</p>
      {b.issueUrl && <p><a href={b.issueUrl} rel="noreferrer noopener">View the issue on GitHub</a></p>}
      {b.criteria.length > 0 && (<><h2>Acceptance criteria</h2><ul>{b.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
      <h2>Pull requests</h2>
      {prs.length === 0 ? <p className="muted">No PRs yet. Open one that says <code>Closes #{b.issueNumber}</code> for this issue.</p> : prs.map((p, i) => (
        <div key={p.id} className="card"><div className="row"><span>#{p.number} by {p.authorLogin}</span><span className="badge">{p.state}</span></div>
          <div className="muted">Rank {i + 1} of {prs.length}{p.reviews[0] ? ` · AI: ${VERDICT[p.reviews[0].verdict] ?? p.reviews[0].verdict} (${p.reviews[0].score}), advisory only` : ' · not reviewed yet'}</div></div>
      ))}
      <h2>Payout</h2>
      {b.payouts.length === 0 ? <p className="muted">Nothing paid yet.</p> : b.payouts.map((p, i) => (
        <p key={i}>PR #{p.prNumber}: {p.status}{p.txHash && <> · <a href={explorerTx(p.txHash)} rel="noreferrer noopener">transaction</a></>}</p>
      ))}
    </>
  );
}
