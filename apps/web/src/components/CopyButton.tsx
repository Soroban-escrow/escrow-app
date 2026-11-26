'use client';
import { useEffect, useId, useRef, useState } from 'react';

/** How a copy attempt ended. */
export type CopyResult = 'copied' | 'manual';

export interface CopyEnv {
  /** `navigator.clipboard`, when the browser exposes it (secure contexts only). */
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  /** Legacy `document.execCommand('copy')` on the current selection. */
  execCopy?: (() => boolean) | undefined;
  /** Selects the full value in a visible field, so the user can copy it by hand. */
  selectAll: () => void;
}

/**
 * Copies `text` with the Clipboard API when it is available and allowed.
 * Otherwise it selects the full value (select-all) and tries the legacy copy
 * command on it; if that also fails, the value stays selected for Ctrl/⌘+C.
 */
export async function copyText(text: string, env: CopyEnv): Promise<CopyResult> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return 'copied';
    } catch {
      // Permission denied or no user activation: fall back below.
    }
  }
  env.selectAll();
  try {
    if (env.execCopy?.()) return 'copied';
  } catch {
    // execCommand can throw in some browsers; the value is still selected.
  }
  return 'manual';
}

export const COPY_STATUS: Record<CopyResult, string> = {
  copied: 'Copied',
  manual: 'Selected. Press Ctrl+C (⌘C on Mac) to copy',
};

/**
 * An accessible copy button for addresses and transaction hashes (#137).
 * `label` names what is copied (e.g. "wallet address") for screen readers; the
 * outcome is announced in a polite live region.
 *
 * The full value always sits in a read-only field. It is visually hidden (but
 * still selectable) until a fallback copy needs the user to press Ctrl/⌘+C,
 * so the select-all fallback works even where the Clipboard API is missing.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<CopyResult | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const manual = status === 'manual';

  useEffect(() => {
    if (status !== 'copied') return;
    const t = setTimeout(() => setStatus(null), 2000);
    return () => clearTimeout(t);
  }, [status]);

  async function onCopy() {
    const result = await copyText(value, {
      clipboard: window.isSecureContext ? navigator.clipboard : undefined,
      execCopy: typeof document.execCommand === 'function' ? () => document.execCommand('copy') : undefined,
      selectAll: () => {
        field.current?.focus();
        field.current?.select();
      },
    });
    setStatus(result);
  }

  return (
    <span className="copy">
      <button type="button" className="ghost copy-button" onClick={onCopy} aria-label={`Copy ${label}`} aria-controls={fieldId}>
        Copy
      </button>
      <input
        id={fieldId}
        ref={field}
        className={manual ? 'copy-field mono' : 'copy-field mono visually-hidden'}
        readOnly
        value={value}
        tabIndex={manual ? 0 : -1}
        aria-hidden={manual ? undefined : true}
        aria-label={`Full ${label}`}
        onFocus={(e) => e.currentTarget.select()}
      />
      <span role="status" aria-live="polite" className="copy-status small">{status ? COPY_STATUS[status] : ''}</span>
    </span>
  );
}
