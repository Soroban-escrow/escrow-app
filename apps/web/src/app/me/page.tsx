'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText } from '@/lib/errors';
import { connect, signLinkMessage, signTx, WalletUxError } from '@/lib/wallet';
import { explorerTx, formatAddress, money, type TokenInfo } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';

interface Funded {
  id: string; issueTitle: string; amount: string; token: string; status: string;
  deadline: string; winnerAddress?: string | null;
  payouts?: { winnerAddress: string | null }[];
}
interface Me { login: string; wallet: string | null; csrfToken: string }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Account() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [funded, setFunded] = useState<Funded[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: 'release' | 'refund' } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe, () => setMe(null));
    fetch('/api/me/funded').then((r) => (r.ok ? r.json() : [])).then(setFunded, () => setFunded([]));
    fetch('/api/config').then((r) => (r.ok ? r.json() : null)).then((c) => setTokens(c?.tokens ?? []), () => setTokens([]));
  }, []);

  const closeConfirm = useCallback(() => setConfirm(null), []);

  /** Maintainer actions: the API builds the transaction, the wallet signs it, the API relays it. */
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
      setMsg({ ok: true, text: `${kind === 'release' ? 'Release' : 'Refund'} submitted.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof WalletUxError ? e.message : 'Something went wrong. Please try again.' });
    } finally { setBusy(false); }
  }

  function onConfirm() {
    if (!confirm) return;
    const { id, kind } = confirm;
    setConfirm(null);
    void act(id, kind);
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

  const confirmed = confirm ? funded.find((f) => f.id === confirm.id) : undefined;
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
          <div className="row muted">
            <span className="amount">{money(f.amount, f.token, tokens)}</span>
            {f.status === 'OPEN' && <span>
              <button disabled={busy} onClick={() => setConfirm({ id: f.id, kind: 'release' })}>Release</button>
              {' '}
              <button className="ghost" disabled={busy} onClick={() => setConfirm({ id: f.id, kind: 'refund' })}>Refund</button>
            </span>}
          </div>
        </div>
      ))}
      {confirm && confirmed && (
        <ConfirmDialog
          action={confirm.kind}
          amount={money(confirmed.amount, confirmed.token, tokens)}
          recipient={confirmed.winnerAddress ?? confirmed.payouts?.[0]?.winnerAddress}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={closeConfirm}
        />
      )}
      {submitted && <p className="muted" role="status">Tracking confirmation… <a href={explorerTx(submitted)} rel="noreferrer noopener">View transaction ↗</a></p>}
      <p className="muted">We never ask for your secret key; you only sign a message in Freighter.</p>
    </>
  );
}
