import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return ['/', '/pricing', '/tools/snow-removal-contract', '/tools/snow-removal-pricing-calculator', '/legal/terms', '/legal/privacy', '/legal/sms-terms'].map((p) => ({ url: `${base}${p}` }));
}
