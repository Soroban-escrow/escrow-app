import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://skillescrow.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/me', '/admin', '/fund/', '/fund/*'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
