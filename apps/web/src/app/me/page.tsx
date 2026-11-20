'use client';
import { useEffect, useState } from 'react';
import { errorText } from '@/lib/errors';
 feat/bounty-filters-api-config-wallet-e2e-contract-errors
import { connect, signLinkMessage, signTx, WalletUxError } from '@/lib/freighter';
import { money, formatAddress, type TokenInfo } from '@/lib/api';

import { refundWindow, explorerTx, formatAddress } from '@/lib/api';
import { connect, signLinkMessage, signTx, WalletUxError } from '@/lib/wallet';
 fresh-build

interface Funded { id: string; issueTitle: string; amount: string; token: string; status: string; deadline: string }
interface Me { login: string; wallet: string | null; csrfToken: string }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Account() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [funded, setFunded] = useState<Funded[]>([]);
 feat/bounty-filters-api-config-wallet-e2e-contract-errors
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const [submitted, setSubmitted] = useState<string | null>(null);
 fresh-build

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe, () => setMe(null));
    fetch('/api/me/funded').then((r) => (r.ok ? r.json() : [])).then(setFunded, () => setFunded([]));
    fetch('/api/config').then((r) => (r.ok ? r.json() : null)).then((c) => setTokens(c?.tokens ?? []), () => setTokens([]));
  }, []);

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
      const sj = await s.json();
      if (!s.ok) throw new WalletUxError('The network rejected the transaction.');
      setSubmitted(sj.hash ?? null);
      setMsg({ ok: true, text: `${kind === 'release' ? 'Release' : 'Refund'} submitted and is being confirmed.` });
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
      {me.wallet ? <p>Linked: <code data-address={me.wallet} title={me.wallet}>{formatAddress(me.wallet).display}</code></p> : <p className="muted">No wallet linked. Link one to be paid when your PR is merged.</p>}
      <button onClick={link} disabled={busy}>{busy ? 'Waiting for Freighter…' : me.wallet ? 'Change wallet' : 'Link wallet'}</button>
      {msg && <p role="status" className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <h2>Funded bounties</h2>
      {funded.length === 0 ? <p className="muted">Nothing funded from this wallet yet.</p> : funded.map((f) => (
        <div key={f.id} className="card">
          <div className="row"><a href={`/b/${f.id}`}>{f.issueTitle || `Bounty ${f.id}`}</a><span className="badge">{f.status}</span></div>
 feat/bounty-filters-api-config-wallet-e2e-contract-errors
          <div className="row muted"><span className="amount">{money(f.amount, f.token, tokens)}</span>
            {f.status === 'OPEN' && <span><button disabled={busy} onClick={() => act(f.id, 'release')}>Release</button> <button className="ghost" disabled={busy} onClick={() => act(f.id, 'refund')}>Refund</button></span>}</div>

          <div className="row muted"><span className="amount">{fromBaseUnits(BigInt(f.amount), 7, 2)}</span>
            {f.status === 'OPEN' && <span><button disabled={busy} onClick={() => act(f.id, 'release')}>Release</button> {refundWindow(f.deadline).open ? <button className="ghost" disabled={busy} onClick={() => act(f.id, 'refund')}>Refund</button> : <small>{refundWindow(f.deadline).label}</small>}</span>}</div>
 fresh-build
        </div>
      ))}
      {submitted && <p className="muted" role="status">Tracking confirmation… <a href={explorerTx(submitted)} rel="noreferrer noopener">View transaction ↗</a></p>}
      <p className="muted">We never ask for your secret key; you only sign a message in Freighter.</p>
    </>
  );
}
