'use client';
import { useEffect, useState } from 'react';
import { connect, signLinkMessage, WalletUxError } from '@/lib/freighter';

interface Me { login: string; wallet: string | null; csrfToken: string }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Account() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then(setMe, () => setMe(null)); }, []);

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
  if (me === null) return <><h1>Account</h1><p>You are not signed in.</p><p className="muted">Sign-in with GitHub needs the GitHub App to be registered for this environment.</p></>;
  return (
    <>
      <h1>{me.login}</h1>
      <h2>Wallet</h2>
      {me.wallet ? <p>Linked: <code>{me.wallet}</code></p> : <p className="muted">No wallet linked. Link one to be paid when your PR is merged.</p>}
      <button onClick={link} disabled={busy}>{busy ? 'Waiting for Freighter…' : me.wallet ? 'Change wallet' : 'Link wallet'}</button>
      {msg && <p role="status" className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <p className="muted">We never ask for your secret key; you only sign a message in Freighter.</p>
    </>
  );
}
