'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { fromBaseUnits } from '@skillescrow/shared/src/amounts';
import { errorText } from '@/lib/errors';
import { connect, signTx, WalletUxError } from '@/lib/freighter';

interface Intent { state: 'open' | 'expired' | 'used'; repo: string | null; issueNumber: number; token: string; amount: string; durationDays: number; bountyId: string | null }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Fund({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = use(params);
  const [intent, setIntent] = useState<Intent | null | undefined>(undefined);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [step, setStep] = useState<'idle' | 'signing' | 'waiting'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/intents/${encodeURIComponent(intentId)}`);
    setIntent(r.ok ? ((await r.json()) as Intent) : null);
  }, [intentId]);

  useEffect(() => { void load(); fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((m) => setCsrf(m?.csrfToken ?? null), () => setCsrf(null)); }, [load]);

  // after submitting, wait for the indexer to mark the intent used, then go to the bounty
  useEffect(() => {
    if (step !== 'waiting') return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/intents/${encodeURIComponent(intentId)}`);
      const i = r.ok ? ((await r.json()) as Intent) : null;
      if (i?.state === 'used' && i.bountyId) window.location.assign(`/b/${i.bountyId}`);
    }, 3000);
    return () => clearInterval(t);
  }, [step, intentId]);

  async function fund() {
    if (!csrf) return;
    setErr(null);
    try {
      const address = await connect(PASSPHRASE);
      const h = { 'content-type': 'application/json', 'x-csrf-token': csrf };
      const b = await fetch(`/api/intents/${encodeURIComponent(intentId)}/build`, { method: 'POST', headers: h, body: JSON.stringify({ address, relayerAllowed: auto }) });
      const bj = await b.json();
      if (!b.ok) throw new WalletUxError(errorText(bj.error?.code, bj.error?.message ?? 'Could not prepare the transaction.'));
      setStep('signing');
      const signed = await signTx(bj.xdr, address, PASSPHRASE);
      const s = await fetch('/api/tx/submit', { method: 'POST', headers: h, body: JSON.stringify({ xdr: signed, address }) });
      const sj = await s.json();
      if (!s.ok) throw new WalletUxError(errorText(sj.error?.code, 'The network rejected the transaction.'));
      setStep('waiting');
    } catch (e) {
      setStep('idle');
      setErr(e instanceof WalletUxError ? e.message : 'Something went wrong. Nothing was charged; you can try again.');
    }
  }

  if (intent === undefined) return <p className="muted">Loading…</p>;
  if (intent === null) return <><h1>Funding link not found</h1><p className="muted">Check the link, or comment <code>/bounty</code> on the issue again.</p></>;
  const amount = fromBaseUnits(BigInt(intent.amount), 7, 2);
  return (
    <>
      <h1>Fund bounty</h1>
      <p><strong>{amount}</strong> on <code>{intent.repo ?? 'repository'}#{intent.issueNumber}</code>, open for {intent.durationDays} days.</p>
      {intent.state === 'expired' && <p className="error" role="alert">{errorText('intent_expired', 'Expired.')}</p>}
      {intent.state === 'used' && <p className="ok">{errorText('intent_used', 'Funded.')} {intent.bountyId && <a href={`/b/${intent.bountyId}`}>View the bounty</a>}</p>}
      {intent.state === 'open' && (
        <>
          {!csrf && <p className="muted">Sign in with GitHub as the person who requested this bounty to continue.</p>}
          <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Pay automatically when I merge a PR (recommended)</label>
          <p className="muted">{auto ? 'A relayer may release this bounty when you merge, capped by the escrow limits.' : 'You will sign the release yourself after merging.'}</p>
          <button onClick={fund} disabled={!csrf || step !== 'idle'}>{step === 'signing' ? 'Confirm in Freighter…' : step === 'waiting' ? 'Waiting for confirmation…' : 'Connect wallet and fund'}</button>
          {err && <p className="error" role="alert">{err}</p>}
          <p className="muted">You need a USDC trustline on your account for USDC bounties. We never ask for your secret key.</p>
        </>
      )}
    </>
  );
}
