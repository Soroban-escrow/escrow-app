import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, apiGetResult, daysLeft, explorerTx, money, type TokenInfo } from '@/lib/api';
import { CopyButton } from '@/components/CopyButton';
import { WalletReminder } from '@/components/WalletReminder';
import { Deadline } from './deadline';
import DisputeRequest from './DisputeRequest';

interface CriterionReview { criterion: string; status: 'met' | 'partial' | 'not_met' | 'unclear'; evidence: string; derived?: boolean }
interface Review { verdict: string; score: number; flags: string[]; criteria?: CriterionReview[]; summary?: string }
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const b = await apiGet<Pick<Detail, 'issueTitle' | 'issueNumber' | 'repo' | 'amount' | 'token'>>(`/bounties/${encodeURIComponent(id)}`);
  if (!b) return { title: 'Bounty not found · SkillEscrow' };
  const title = b.issueTitle || `Issue #${b.issueNumber}`;
  return {
    title: `${title} · SkillEscrow`,
    description: `${b.repo.fullName} · ${money(b.amount, b.token)} bounty on Stellar.`,
    openGraph: { title, description: `${b.repo.fullName} bounty on Stellar.`, type: 'article', images: [`/b/${encodeURIComponent(id)}/opengraph-image`] },
    twitter: { card: 'summary_large_image', title, description: `${b.repo.fullName} bounty on Stellar.` },
  };
}

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
  const [response, config] = await Promise.all([
    apiGetResult<Detail>(`/bounties/${encodeURIComponent(id)}`),
    apiGet<{ tokens: TokenInfo[] }>('/config'),
  ]);
  if (response.kind === 'not_found') notFound();
  if (response.kind === 'unavailable') return <><h1>Temporarily unavailable</h1><p className="muted">The bounty service is unavailable. This is not a missing page; please retry shortly.</p></>;
  const b = response.data;
  const tokens: TokenInfo[] = config?.tokens ?? [];
  const prs = [...b.prs].sort((x, y) => {
    const rx = x.reviews[0], ry = y.reviews[0];
    return (ORDER.indexOf(rx?.verdict ?? 'needs_human') - ORDER.indexOf(ry?.verdict ?? 'needs_human')) || ((ry?.score ?? 0) - (rx?.score ?? 0));
  });
  const { steps: stepSet, done: stepDone, active: stepActive } = stepper(b);

  return (
    <>
      <p className="crumbs"><Link href="/">Bounties</Link> / {b.repo.fullName} / #{b.issueNumber}</p>
      <h1 className="title">{b.issueTitle || `Issue #${b.issueNumber}`}</h1>

      <div className="hero-amount">
        <span className={`big${b.status === 'OPEN' ? ' locked' : ''}`} title={tokens.some((t) => t.address === b.token) ? undefined : `Unknown token ${b.token}`}>{money(b.amount, b.token, tokens)}</span>
        <span className={`status ${b.status.toLowerCase()}`}>{b.status === 'RELEASED' ? 'Paid' : b.status.toLowerCase()}</span>
      </div>

      <dl className="facts">
        <div><dt>Deadline</dt><dd><Deadline iso={b.deadline} /></dd></div>
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
      {(b.status === 'OPEN' || b.status === 'DISPUTED') && <DisputeRequest bountyId={b.id} />}

      <WalletReminder prAuthors={b.prs.map((p) => p.authorLogin)} />

      {b.criteria.length > 0 && (
        <>
          <h2>Acceptance criteria</h2>
          <ol className="criteria">{b.criteria.map((c, i) => {
            const reviews = b.prs.flatMap((p) => p.reviews[0]?.criteria ?? []).filter((r) => r.criterion === c);
            return <li key={i}><span><span>{c}</span>{reviews.length > 0 && <span className="criterion-reviews" aria-label={`AI review results for criterion ${i + 1}`}>{reviews.map((r, n) => <span className={`criterion-result ${r.status}`} key={`${r.status}-${n}`}><strong>{r.status.replace('_', ' ')}</strong>: {r.evidence}</span>)}</span>}</span></li>;
          })}</ol>
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
              {p.txHash && (
                <span>
                  <a className="mono" href={explorerTx(p.txHash)} rel="noreferrer noopener" title={p.txHash}>tx {p.txHash.slice(0, 8)}… ↗</a>
                  <CopyButton value={p.txHash} label={`transaction hash for PR #${p.prNumber}`} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {b.issueUrl && <p className="small" style={{ marginTop: '2rem' }}><a href={b.issueUrl} rel="noreferrer noopener">View the issue on GitHub ↗</a></p>}
    </>
  );
}
