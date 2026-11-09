'use client';
import { useEffect, useState } from 'react';
import { fromBaseUnits } from '@skillescrow/shared/src/amounts';
import { checkWalletBalances, type WalletReadiness } from '@skillescrow/shared/src/readiness';
import { errorText } from '@/lib/errors';
import { connect, signLinkMessage, signTx, WalletUxError } from '@/lib/freighter';

interface Funded { id: string; issueTitle: string; amount: string; status: string; deadline: string }
interface Me { login: string; wallet: string | null; csrfToken: string }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Account() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [funded, setFunded] = useState<Funded[]>([]);
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe, () => setMe(null));
    fetch('/api/me/funded').then((r) => (r.ok ? r.json() : [])).then(setFunded, () => setFunded([]));
  }, []);

  useEffect(() => {
    if (!me?.wallet) {
      setReadiness(null);
      return;
    }
    const horizonUrl = PASSPHRASE.includes('Test') ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
    fetch(`${horizonUrl}/accounts/${me.wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((acc) => {
        const res = checkWalletBalances(acc?.balances, 'USDC');
        setReadiness(res);
      })
      .catch(() => {
        setReadiness(checkWalletBalances(undefined, 'USDC'));
      });
  }, [me?.wallet]);

  /** Maintainer actions: the API builds the transaction, Freighter signs it, the API relays it. */
  async function act(id: string, kind: 'release' | 'refund') {
    if (!me?.wallet) return;
    setBusy(true); setMsg(null);
    try {
      const address = await connect(PASSPHRASE);
      if (address !== me.wallet) throw new WalletUxError(errorText('not_maintainer', 'Wrong wallet.'));
      const h = { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken };
      const b = await fetch(`/api/bounties/${id}/${kind}/build`, { method: 'POST', headers: h, body: '{}' });
      const bj = await b.json();
      if (!b.ok) throw new WalletUxError(errorText(bj.error?.code, bj.error?.message ?? 'Could not prepare the transaction.'));
      const signed = await signTx(bj.xdr, address, PASSPHRASE);
      const s = await fetch('/api/tx/submit', { method: 'POST', headers: h, body: JSON.stringify({ xdr: signed, address }) });
      if (!s.ok) throw new WalletUxError('The network rejected the transaction.');
      setMsg({ ok: true, text: `${kind === 'release' ? 'Release' : 'Refund'} submitted. The status updates once it confirms.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof WalletUxError ? e.message : 'Something went wrong. Please try again.' });
    } finally { setBusy(false); }
  }

  async function link() {
    if (!me) return;
    setBusy(true); setMsg(null);
    try {
      const address = await connect(PASSPHRASE);
      const h = { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken };
      const c = await fetch('/api/wallet/challenge', { method: 'POST', headers: h, body: JSON.stringify({ address }) });
      const cj = await c.json();
      if (!c.ok) throw new WalletUxError(cj.error?.message ?? 'Could not start linking.');
      const signature = await signLinkMessage(cj.message, address, PASSPHRASE);
      const v = await fetch('/api/wallet/verify', { method: 'POST', headers: h, body: JSON.stringify({ challengeId: cj.challengeId, signature }) });
      const vj = await v.json();
      if (!v.ok) throw new WalletUxError(vj.error?.message ?? 'Verification failed.');
      setMe({ ...me, wallet: vj.address }); setMsg({ ok: true, text: 'Wallet linked.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof WalletUxError ? e.message : 'Something went wrong. Please try again.' });
    } finally { setBusy(false); }
  }

  if (me === undefined) return <p className="muted">Loading…</p>;
  if (me === null) return (
    <>
      <h1>Account</h1>
      <p className="lede">You are not signed in.</p>
      <a className="cta" href="/api/auth/login?next=/me">Sign in with GitHub</a>
    </>
  );
  return (
    <>
      <p className="eyebrow" style={{ marginTop: '2.5rem' }}>Account</p>
      <h1>{me.login}</h1>
      <h2>Wallet</h2>
      {me.wallet ? (
        <>
          <p>Linked: <code>{me.wallet}</code></p>
          {readiness && (
            <div className={`panel ${readiness.ready ? 'ok-panel' : 'warn-panel'}`} style={{ marginBottom: '1rem' }}>
              <p style={{ margin: 0 }}>
                <strong>Payout Readiness: </strong>
                {readiness.ready ? (
                  <span className="badge">Ready for USDC payouts</span>
                ) : (
                  <span className="badge" style={{ color: 'var(--red, #e53e3e)' }}>Setup needed</span>
                )}
              </p>
              {readiness.warnings.length > 0 && (
                <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
                  {readiness.warnings.map((w, idx) => (
                    <li key={idx} className="muted small">{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">No wallet linked. Link one to be paid when your PR is merged.</p>
      )}
      <button onClick={link} disabled={busy}>{busy ? 'Waiting for Freighter…' : me.wallet ? 'Change wallet' : 'Link wallet'}</button>
      {msg && <p role="status" className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <h2>Funded bounties</h2>
      {funded.length === 0 ? <p className="muted">Nothing funded from this wallet yet.</p> : funded.map((f) => (
        <div key={f.id} className="card">
          <div className="row"><a href={`/b/${f.id}`}>{f.issueTitle || `Bounty ${f.id}`}</a><span className="badge">{f.status}</span></div>
          <div className="row muted"><span className="amount">{fromBaseUnits(BigInt(f.amount), 7, 2)}</span>
            {f.status === 'OPEN' && <span><button disabled={busy} onClick={() => act(f.id, 'release')}>Release</button> <button className="ghost" disabled={busy} onClick={() => act(f.id, 'refund')}>Refund</button></span>}</div>
        </div>
      ))}
      <p className="muted">We never ask for your secret key; you only sign a message in Freighter.</p>
    </>
  );
}
