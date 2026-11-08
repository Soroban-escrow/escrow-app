import type { MetadataRoute } from 'next';
import { apiGet, type BountySummary } from '../lib/api';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://skillescrow.com';

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/docs`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/install`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  try {
    const data = await apiGet<{ items: BountySummary[] }>('/bounties?sort=newest&limit=50');
    const bounties = data?.items ?? [];

    const bountyRoutes: MetadataRoute.Sitemap = bounties.map((b) => ({
      url: `${siteUrl}/b/${encodeURIComponent(b.id)}`,
      lastModified: new Date(b.createdAt),
      changeFrequency: 'daily',
      priority: 0.9,
    }));

    return [...staticRoutes, ...bountyRoutes];
  } catch {
    return staticRoutes;
  }
}
