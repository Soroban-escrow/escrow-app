import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, explorerTx, money } from '@/lib/api';

export default async function Profile({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const res = await apiGet<{ login: string; paid: { bounty: { id: string; issueTitle: string; amount: string; token: string }; txHash: string | null }[] }>(`/users/${encodeURIComponent(login)}`);

  if (!res.ok) {
    if (res.kind === 'not_found') {
      notFound();
    }

    return (
      <section>
        <h1 className="title">User profile temporarily unavailable</h1>
        <p className="notice" role="alert">
          We could not reach the escrow API service to load this profile. Please try again shortly.
        </p>
        <p style={{ marginTop: '1.5rem' }}>
          <Link href={`/u/${login}`} className="cta" style={{ marginRight: '1rem' }}>
            Try again
          </Link>
          <Link href="/" className="muted">
            Back to open bounties
          </Link>
        </p>
      </section>
    );
  }

  const u = res.data;
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
