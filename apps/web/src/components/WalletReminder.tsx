'use client';
import { useEffect, useState } from 'react';

/** The fields of `/auth/me` this reminder needs. */
export interface Viewer { login: string; wallet: string | null }

/**
 * Whether to remind the viewer to link a wallet (#136): only a signed-in
 * viewer with no wallet who authored one of this bounty's linked PRs.
 * GitHub logins are case-insensitive.
 */
export function shouldRemindToLinkWallet(viewer: Viewer | null | undefined, prAuthors: readonly string[]): boolean {
  if (!viewer || viewer.wallet) return false;
  const login = viewer.login.toLowerCase();
  return prAuthors.some((author) => author.toLowerCase() === login);
}

/** The reminder itself; renders nothing unless {@link shouldRemindToLinkWallet} holds. */
export function WalletReminderView({ viewer, prAuthors }: { viewer: Viewer | null | undefined; prAuthors: readonly string[] }) {
  if (!shouldRemindToLinkWallet(viewer, prAuthors)) return null;
  return (
    <p className="notice" role="note">
      You opened a pull request for this bounty, but you have not linked a wallet yet. Payouts go to a linked
      wallet, so <a href="/me">link one on your Account page</a> before your PR is merged.
    </p>
  );
}

/**
 * Bounty-page reminder for contributors without a wallet. The page itself is
 * server-rendered without the viewer's session, so this reads `/auth/me` in
 * the browser and stays empty while loading or when signed out.
 */
export function WalletReminder({ prAuthors }: { prAuthors: readonly string[] }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  useEffect(() => {
    if (prAuthors.length === 0) return;
    let live = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? (r.json() as Promise<Viewer>) : null))
      .then((me) => { if (live) setViewer(me); }, () => { if (live) setViewer(null); });
    return () => { live = false; };
  }, [prAuthors.length]);
  return <WalletReminderView viewer={viewer} prAuthors={prAuthors} />;
}
