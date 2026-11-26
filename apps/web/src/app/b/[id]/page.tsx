import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, apiGetResult, daysLeft, explorerTx, money, type TokenInfo } from '@/lib/api';

interface Review { verdict: string; score: number; flags: string[] }
interface Detail {
  id: string; issueNumber: number; issueTitle: string; issueUrl: string; amount: string; token: string; status: string;
  deadline: string; maintainer: string; criteria: string[]; relayerAllowed: boolean; feeBps: number; repo: { fullName: string };
  fundTx: string; closeTx: string | null;
  prs: { id: string; number: number; authorLogin: string; state: string; reviews: Review[] }[];
  payouts: { status: string; prNumber: number; txHash: string | null }[];
}

const VERDICT: Record<string, string> = { likely_meets: 'Likely meets', partially_meets: 'Partially meets', does_not_meet: 'Does not meet', needs_human: 'Needs a human' };
const ORDER = ['likely_meets', 'partially_meets', 'does_not_meet', 'needs_human'];
const STEPS = ['Funded', 'In review', 'Merged', 'Paid'] as const;
const PAYOUT: Record<string, string> = {
  PENDING_WALLET: 'Waiting for the author to link a wallet', QUEUED: 'Queued for release', SUBMITTED: 'Release submitted',
  CONFIRMED: 'Paid', FAILED: 'Failed, an admin is looking at it', AWAITING_MAINTAINER: 'Waiting for the maintainer to sign',
};
const NOTICE: Record<string, string> = {
  REFUNDED: 'Nothing was merged in time, so the maintainer reclaimed the funds.',
  DISPUTED: 'This bounty is under dispute. Release and refund are frozen until an arbiter decides.',
  RESOLVED: 'An arbiter resolved a dispute on this bounty and split the funds.',
};

/** How far along the funded → paid path this bounty is: steps done, and which one is current. */
function progress(b: Detail): number {
  if (b.status === 'RELEASED') return 4;
  if (b.payouts.length) return 2;
  if (b.prs.length) return 1;
  return 0;
}

/** Step set and current position for the progress stepper, including terminal states. */
function stepper(b: Detail): { steps: readonly string[]; done: number; active: boolean } {
  if (b.status === 'REFUNDED') return { steps: ['Funded', 'Refunded'], done: 2, active: false };
  if (b.status === 'DISPUTED') return { steps: ['Funded', 'Disputed'], done: 1, active: true };
  if (b.status === 'RESOLVED') return { steps: ['Funded', 'Disputed', 'Resolved'], done: 3, active: false };
  const done = progress(b);
  return { steps: STEPS, done, active: b.status === 'OPEN' };
}

export default async function Bounty({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await apiGetResult<Detail>(`/bounties/${encodeURIComponent(id)}`);
  if (response.kind === 'not_found') notFound();
  if (response.kind === 'unavailable') return <><h1>Temporarily unavailable</h1><p className="muted">The bounty service is unavailable. This is not a missing page; please retry shortly.</p></>;
  const b = response.data;
  const config = await apiGet<{ tokens: TokenInfo[] }>('/config');
  const prs = [...b.prs].sort((x, y) => {
    const rx = x.reviews[0], ry = y.reviews[0];
    return (ORDER.indexOf(rx?.verdict ?? 'needs_human') - ORDER.indexOf(ry?.verdict ?? 'needs_human')) || ((ry?.score ?? 0) - (rx?.score ?? 0));
  });
  const { steps: stepSet, done: stepDone, active: stepActive } = stepper(b);
  const deadline = new Date(b.deadline);

  return (
    <>
      <p className="crumbs"><Link href="/">Bounties</Link> / {b.repo.fullName} / #{b.issueNumber}</p>
      <h1 className="title">{b.issueTitle || `Issue #${b.issueNumber}`}</h1>

      <div className="hero-amount">
        <span className={`big${b.status === 'OPEN' ? ' locked' : ''}`} title={config?.tokens.some((t) => t.address === b.token) ? undefined : `Unknown token ${b.token}`}>{money(b.amount, b.token, config?.tokens)}</span>
        <span className={`status ${b.status.toLowerCase()}`}>{b.status === 'RELEASED' ? 'Paid' : b.status.toLowerCase()}</span>
      </div>

      <dl className="facts">
        <div><dt>Deadline</dt><dd>{deadline.toISOString().slice(0, 10)}</dd></div>
        <div><dt>Time left</dt><dd>{daysLeft(b.deadline)}</dd></div>
        <div><dt>Release on merge</dt><dd>{b.relayerAllowed ? 'automatic' : 'maintainer signs'}</dd></div>
        <div><dt>Fee</dt><dd>{b.feeBps / 100}% of payout</dd></div>
        {b.fundTx && (
          <div>
            <dt>Funded in tx</dt>
            <dd><a className="mono" href={explorerTx(b.fundTx)} rel="noreferrer noopener">{b.fundTx.slice(0, 8)}… ↗</a></dd>
          </div>
        )}
        {b.closeTx && (
          <div>
            <dt>Closed in tx</dt>
            <dd><a className="mono" href={explorerTx(b.closeTx)} rel="noreferrer noopener">{b.closeTx.slice(0, 8)}… ↗</a></dd>
          </div>
        )}
      </dl>

      <ol className="steps" aria-label="Progress">
        {stepSet.map((s, i) => (
          <li key={s} className={i < stepDone ? 'done' : i === stepDone && stepActive ? 'now' : ''} aria-current={i === stepDone && stepActive ? 'step' : undefined}>{s}</li>
        ))}
      </ol>
      {NOTICE[b.status] && <p className="notice">{NOTICE[b.status]}</p>}

      {b.criteria.length > 0 && (
        <>
          <h2>Acceptance criteria</h2>
          <ol className="criteria">{b.criteria.map((c, i) => <li key={i}>{c}</li>)}</ol>
        </>
      )}

      <h2>Pull requests</h2>
      {prs.length === 0 ? (
        <p className="muted">No pull requests yet. Open one that says <code>Closes #{b.issueNumber}</code>, and link your wallet on the Account page before it is merged.</p>
      ) : (
        <>
          <p className="muted small">Ranked by an AI review against the criteria. It is advisory only; the maintainer decides by merging.</p>
          <ol className="prs">
            {prs.map((p, i) => {
              const r = p.reviews[0];
              return (
                <li key={p.id} className="card pr-row">
                  <span className="rank" aria-hidden="true">{i + 1}</span>
                  <span>
                    <span className="pr-title">#{p.number} by {p.authorLogin}</span>
                    <span className="muted small"> · Rank {i + 1} of {prs.length} · {p.state}</span>
                  </span>
                  <span className={`verdict ${r?.verdict ?? ''}`}>{r ? `${VERDICT[r.verdict] ?? r.verdict} (${r.score})` : 'Not reviewed yet'}</span>
                  {r && <span className="score" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} /></span>}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <h2>Payout</h2>
      {b.payouts.length === 0 ? (
        <p className="muted">Nothing paid yet. Funds stay in escrow until a linked PR is merged.</p>
      ) : (
        <ul className="payouts">
          {b.payouts.map((p, i) => (
            <li key={i}>
              <span>PR #{p.prNumber}: {PAYOUT[p.status] ?? p.status}</span>
              {p.txHash && <a className="mono" href={explorerTx(p.txHash)} rel="noreferrer noopener">tx {p.txHash.slice(0, 8)}… ↗</a>}
            </li>
          ))}
        </ul>
      )}

      {b.issueUrl && <p className="small" style={{ marginTop: '2rem' }}><a href={b.issueUrl} rel="noreferrer noopener">View the issue on GitHub ↗</a></p>}
    </>
  );
}
