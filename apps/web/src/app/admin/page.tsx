'use client';
import { useCallback, useEffect, useState } from 'react';
import { fromBaseUnits } from '@skillescrow/shared/src/amounts';
import { errorText } from '@/lib/errors';
import { connect, signTx, WalletUxError } from '@/lib/freighter';

interface Dispute { id: string; status: string; reason: string; createdAt: string; overdue: boolean; resolutionNote: string | null; bounty: { id: string; issueTitle: string; amount: string; maintainer: string; repo: { fullName: string }; prs: { number: number; authorLogin: string; reviews: { verdict: string; score: number }[] }[] } }
interface Payout { id: string; bountyId: string; prNumber: number; lastError: string | null; txHash: string | null }
interface Status { indexerLedger: number | null; failedPayouts: number; waitingPayouts: number; openDisputes: number }
const PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

export default function Admin() {
  const [me, setMe] = useState<{ isAdmin: boolean; csrfToken: string } | null | undefined>(undefined);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<Record<string, { winner: string; bps: string; note: string }>>({});

  const load = useCallback(async () => {
    const j = (u: string) => fetch(`/api${u}`).then((r) => (r.ok ? r.json() : null));
    const [d, p, s] = await Promise.all([j('/admin/disputes'), j('/admin/payouts?status=FAILED'), j('/admin/status')]);
    setDisputes(d ?? []); setPayouts(p ?? []); setStatus(s);
  }, []);
  useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((m) => { setMe(m); if (m?.isAdmin) void load(); }, () => setMe(null)); }, [load]);

  const hdr = () => ({ 'content-type': 'application/json', 'x-csrf-token': me!.csrfToken });
  async function call(url: string, body: object) {
    const r = await fetch(`/api${url}`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new WalletUxError(errorText(j.error?.code, j.error?.message ?? 'Request failed.'));
    return j;
  }
  async function signAndSubmit(xdr: string, address: string) {
    const signed = await signTx(xdr, address, PASSPHRASE);
    await call('/tx/submit', { xdr: signed, address });
  }
  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof WalletUxError ? e.message : 'Something went wrong.' }); }
  }

  const openOnChain = (d: Dispute) => run(async () => {
    const arbiter = await connect(PASSPHRASE); // the arbiter key stays in Freighter, never on the server
    const { xdr } = await call(`/admin/disputes/${d.id}/open-onchain`, { arbiterAddress: arbiter });
    await signAndSubmit(xdr, arbiter);
    return 'Dispute opened on chain. Release and refund are frozen for this bounty.';
  });
  const resolve = (d: Dispute) => run(async () => {
    const f = form[d.id] ?? { winner: '', bps: '', note: '' };
    const bps = Number(f.bps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new WalletUxError('Winner share must be 0 to 10000 basis points.');
    const arbiter = await connect(PASSPHRASE);
    const { xdr } = await call(`/admin/disputes/${d.id}/resolve/build`, { arbiterAddress: arbiter, winnerBps: bps, ...(bps > 0 ? { winner: f.winner } : {}), note: f.note });
    await signAndSubmit(xdr, arbiter);
    return 'Resolution submitted. The bounty updates once it confirms.';
  });
  const reject = (d: Dispute) => run(async () => {
    const note = (form[d.id]?.note ?? '').trim();
    if (!note) throw new WalletUxError('Add a note explaining the rejection.');
    await call(`/admin/disputes/${d.id}/reject`, { note });
    return 'Dispute rejected.';
  });
  const retry = (p: Payout) => run(async () => { await call(`/admin/payouts/${p.id}/retry`, {}); return 'Payout re-queued.'; });
  const set = (id: string, k: 'winner' | 'bps' | 'note', v: string) => setForm((s) => ({ ...s, [id]: { winner: '', bps: '', note: '', ...s[id], [k]: v } }));

  if (me === undefined) return <p className="muted">Loading…</p>;
  if (!me?.isAdmin) return <><h1>Admin</h1><p className="error" role="alert">Admins only.</p></>;
  return (
    <>
      <h1>Admin</h1>
      {status && <p className="muted">Indexer ledger {status.indexerLedger ?? 'n/a'} · {status.openDisputes} open disputes · {status.failedPayouts} failed payouts · {status.waitingPayouts} waiting</p>}
      {msg && <p role="status" className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <h2>Disputes (oldest first)</h2>
      {disputes.length === 0 ? <p className="muted">No open disputes.</p> : disputes.map((d) => (
        <div key={d.id} className="card" style={d.overdue ? { borderColor: 'var(--warn)' } : undefined}>
          <div className="row"><strong>{d.bounty.repo.fullName} · {d.bounty.issueTitle || `Bounty ${d.bounty.id}`}</strong><span className="badge">{d.status}{d.overdue ? ' · over 36 h' : ''}</span></div>
          <p className="muted">{fromBaseUnits(BigInt(d.bounty.amount), 7, 2)} · maintainer <code>{d.bounty.maintainer}</code></p>
          <p>Reason: {d.reason}</p>
          <p className="muted">PRs: {d.bounty.prs.map((p) => `#${p.number} ${p.authorLogin}${p.reviews[0] ? ` (AI: ${p.reviews[0].verdict} ${p.reviews[0].score})` : ''}`).join(', ') || 'none'}</p>
          {d.status === 'requested' && <p><button onClick={() => openOnChain(d)}>Open on chain</button></p>}
          {d.status === 'opened_onchain' && (
            <p className="row">
              <input placeholder="Winner G… address" value={form[d.id]?.winner ?? ''} onChange={(e) => set(d.id, 'winner', e.target.value)} aria-label="Winner address" />
              <input placeholder="Winner bps (0–10000)" inputMode="numeric" value={form[d.id]?.bps ?? ''} onChange={(e) => set(d.id, 'bps', e.target.value)} aria-label="Winner basis points" />
              <button onClick={() => resolve(d)}>Resolve</button>
            </p>
          )}
          <p className="row"><input placeholder="Note" value={form[d.id]?.note ?? ''} onChange={(e) => set(d.id, 'note', e.target.value)} aria-label="Note" />{d.status === 'requested' && <button onClick={() => reject(d)}>Reject</button>}</p>
        </div>
      ))}
      <h2>Failed payouts</h2>
      {payouts.length === 0 ? <p className="muted">None.</p> : payouts.map((p) => (
        <div key={p.id} className="card"><div className="row"><span>Bounty {p.bountyId} · PR #{p.prNumber}</span>{!p.txHash ? <button onClick={() => retry(p)}>Retry</button> : <span className="muted">tx submitted: verify on chain</span>}</div><div className="muted">{p.lastError}</div></div>
      ))}
    </>
  );
}
