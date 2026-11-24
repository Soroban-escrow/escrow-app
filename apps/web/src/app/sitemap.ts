import type { MetadataRoute } from 'next';
import { apiGet, type BountySummary } from '@/lib/api';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
  const data = await apiGet<{ items: BountySummary[] }>('/bounties?status=ALL&limit=50');
  return [
    { url: base, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/docs`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/install`, changeFrequency: 'monthly', priority: 0.4 },
    ...(data?.items ?? []).map((b) => ({ url: `${base}/b/${b.id}`, lastModified: b.createdAt, changeFrequency: 'daily' as const, priority: 0.8 })),
  ];
}
