'use client';
import { useState } from 'react';

export default function DisputeRequest({ bountyId }: { bountyId: string }) {
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  async function submit() {
    setState('sending'); setMessage('');
    const r = await fetch(`/api/bounties/${encodeURIComponent(bountyId)}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setState('error'); setMessage(data.error?.message ?? 'Could not request a dispute.'); return; }
    setState('done'); setMessage('Dispute request sent to the review queue.');
  }
  return <section className="panel"><h2>Request a dispute</h2><p className="muted small">Maintainers and contributors with a linked pull request can ask for human review.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Explain what needs review" aria-label="Dispute reason" disabled={state === 'sending' || state === 'done'} /> <button onClick={submit} disabled={reason.trim().length < 3 || state === 'sending' || state === 'done'}>{state === 'sending' ? 'Sending…' : 'Request dispute'}</button>{message && <p className={state === 'error' ? 'error' : 'ok'} role="status">{message}</p>}</section>;
}
