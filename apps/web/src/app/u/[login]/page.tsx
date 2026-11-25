import { notFound } from 'next/navigation';
import { apiGet, explorerTx, money, type TokenInfo } from '@/lib/api';

export default async function Profile({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const normalized = login.toLowerCase();
  const [u, config] = await Promise.all([
    apiGet<{
      login: string;
      paid: { bounty: { id: string; issueTitle: string; amount: string; token: string }; txHash: string | null }[];
      earnedByToken: { token: string; amount: string }[];
      paidCount: number;
      firstPayoutAt: string | null;
    }>(`/users/${encodeURIComponent(normalized)}`),
    apiGet<{ tokens: TokenInfo[] }>('/config'),
  ]);
  if (!u) notFound();
  return (
    <>
      <h1>{u.login}</h1>
      <h2>Earned</h2>
      {u.earnedByToken.length === 0 ? <p className="muted">No confirmed payouts yet.</p> : (
        <p>{u.earnedByToken.map((total) => money(total.amount, total.token, config?.tokens)).join(' · ')}</p>
      )}
      <p className="muted">{u.paidCount} paid {u.paidCount === 1 ? 'bounty' : 'bounties'}{u.firstPayoutAt && <> · First payout <time dateTime={u.firstPayoutAt}>{new Date(u.firstPayoutAt).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}</time></>}</p>
      <h2>Paid bounties</h2>
      {u.paid.length === 0 ? <p className="muted">None yet.</p> : u.paid.map((p) => (
        <p key={p.bounty.id}><a href={`/b/${p.bounty.id}`}>{p.bounty.issueTitle || `Bounty ${p.bounty.id}`}</a> · {money(p.bounty.amount, p.bounty.token, config?.tokens)}{p.txHash && <> · <a href={explorerTx(p.txHash)}>tx</a></>}</p>
      ))}
    </>
  );
}
