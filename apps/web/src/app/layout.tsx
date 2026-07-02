import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'SkillEscrow Bounties', description: 'Paid GitHub issues with AI PR triage, settled in USDC on Stellar.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bar">
          <Link href="/" className="brand">SkillEscrow</Link>
          <nav><Link href="/install">Install</Link><Link href="/docs">Docs</Link><Link href="/me">Account</Link></nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
