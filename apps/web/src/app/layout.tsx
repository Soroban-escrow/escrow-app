import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' });

export const metadata: Metadata = {
  title: 'SkillEscrow Bounties',
  description: 'Paid GitHub issues, settled in USDC on Stellar. The pull request you merge gets paid from escrow.',
};
export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f6f5f1' }, { media: '(prefers-color-scheme: dark)', color: '#0e0e0d' }],
};

const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <header className="bar">
          <Link href="/" className="brand" aria-label="SkillEscrow home"><span className="brand-mark" aria-hidden="true" />skillescrow</Link>
          <nav aria-label="Main">
            <span className="net" title="Stellar network this app uses">{NETWORK}</span>
            <Link href="/">Bounties</Link>
            <Link href="/docs" className="nav-optional">Docs</Link>
            <Link href="/install">Install</Link>
            <Link href="/me">Account</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="foot">
          <span>Funds are held by a Soroban contract on Stellar, not by us.</span>
          <span>AI reviews are advisory. Merging is the approval.</span>
        </footer>
      </body>
    </html>
  );
}
