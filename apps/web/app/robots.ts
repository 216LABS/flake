import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/c/', '/d/', '/q/', '/join/', '/s/', '/supplier/', '/admin', '/api/', '/dev/', '/dashboard', '/settings'] }], sitemap: `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/sitemap.xml` };
}
