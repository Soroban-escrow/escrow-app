'use client';
import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  action: 'release' | 'refund';
  amount: string;
  recipient?: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Accessible confirmation for an irreversible maintainer action: labelled, Escape-to-close, focus-trapped. */
export function ConfirmDialog({ action, amount, recipient, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onConfirm, onCancel });
  handlers.current = { onConfirm, onCancel };

  const label = action === 'release' ? 'Release' : 'Refund';

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handlers.current.onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) handlers.current.onCancel(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc" className="card modal">
        <h2 id="confirm-title">Confirm {label.toLowerCase()}</h2>
        <p id="confirm-desc">
          You are about to <strong>{label.toLowerCase()}</strong> <strong>{amount}</strong>
          {action === 'release' ? <> to <strong>{recipient ?? 'the winning PR author'}</strong></> : null}.
        </p>
        <p className="error" role="alert">This action is irreversible. Once submitted, the funds cannot be recovered.</p>
        <div className="row">
          <button ref={cancel} className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={onConfirm} disabled={busy}>{busy ? 'Submitting…' : `Confirm ${label}`}</button>
        </div>
      </div>
    </div>
  );
}
