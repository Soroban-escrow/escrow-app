import { notFound } from 'next/navigation';
import { apiGet, explorerTx, money } from '@/lib/api';

export default async function Profile({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const u = await apiGet<{ login: string; paid: { bounty: { id: string; issueTitle: string; amount: string; token: string }; txHash: string | null }[] }>(`/users/${encodeURIComponent(login)}`);
  if (!u) notFound();
  return (
    <>
      <h1>{u.login}</h1>
      <h2>Paid bounties</h2>
      {u.paid.length === 0 ? <p className="muted">None yet.</p> : u.paid.map((p) => (
        <p key={p.bounty.id}><a href={`/b/${p.bounty.id}`}>{p.bounty.issueTitle || `Bounty ${p.bounty.id}`}</a> · {money(p.bounty.amount, p.bounty.token)}{p.txHash && <> · <a href={explorerTx(p.txHash)}>tx</a></>}</p>
      ))}
    </>
  );
}
