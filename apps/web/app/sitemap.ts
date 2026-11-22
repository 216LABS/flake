import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return ['/', '/free-season', '/compare', '/tools/snow-removal-contract', '/tools/snow-removal-pricing-calculator', '/tools/snow-removal-invoice-template', '/tools/snow-removal-estimate-template', '/tools/snow-plow-log-sheet', '/legal/terms', '/legal/privacy', '/legal/sms-terms', '/legal/data-retention', '/security', '/status'].map((p) => ({ url: `${base}${p}` }));
}
