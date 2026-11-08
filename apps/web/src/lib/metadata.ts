import type { Metadata } from 'next';
import { apiGet, money, type Detail } from './api';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://skillescrow.com';

export function escapeMarkup(str: string): string {
  return str.replace(/[<>]/g, '');
}

export function truncateText(str: string, maxLen = 120): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1).trimEnd()}…`;
}

export async function buildBountyMetadata(id: string): Promise<Metadata> {
  const b = await apiGet<Detail>(`/bounties/${encodeURIComponent(id)}`);
  if (!b) {
    return {
      title: 'Bounty Not Found · SkillEscrow',
      robots: { index: false, follow: false },
    };
  }

  const cleanTitle = truncateText(escapeMarkup(b.issueTitle || `Issue #${b.issueNumber}`), 80);
  const title = `${money(b.amount, b.token)} bounty: ${cleanTitle}, ${b.repo.fullName} #${b.issueNumber}`;
  const isTerminal = b.status === 'RELEASED' || b.status === 'REFUNDED' || b.status === 'RESOLVED';
  const description = `Earn ${money(b.amount, b.token)} by contributing to ${b.repo.fullName} #${b.issueNumber}. Merging is the approval, settled automatically on Stellar.`;
  const canonicalUrl = `${SITE_URL}/b/${encodeURIComponent(id)}`;

  return {
    title,
    description: truncateText(description, 160),
    alternates: {
      canonical: canonicalUrl,
    },
    robots: isTerminal
      ? { index: false, follow: true }
      : { index: true, follow: true },
    openGraph: {
      title,
      description: truncateText(description, 160),
      url: canonicalUrl,
      type: 'article',
      siteName: 'SkillEscrow',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: truncateText(description, 160),
    },
  };
}

export async function buildProfileMetadata(login: string): Promise<Metadata> {
  const u = await apiGet<{ login: string; paid: unknown[] }>(`/users/${encodeURIComponent(login)}`);
  if (!u) {
    return {
      title: 'Profile Not Found · SkillEscrow',
      robots: { index: false, follow: false },
    };
  }

  const cleanLogin = truncateText(escapeMarkup(u.login), 40);
  const title = `${cleanLogin}'s Contributor Profile · SkillEscrow`;
  const description = `View open source contributions, bounty earnings, and on-chain payout history for @${cleanLogin}.`;
  const canonicalUrl = `${SITE_URL}/u/${encodeURIComponent(login)}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'profile',
      siteName: 'SkillEscrow',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}
