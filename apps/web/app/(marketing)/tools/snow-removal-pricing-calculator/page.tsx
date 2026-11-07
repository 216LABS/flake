import type { Metadata } from 'next';
import { Calculator } from './calculator';

export const metadata: Metadata = {
  title: 'Free Snow Removal Pricing Calculator',
  description: 'Estimate per push, per event and seasonal snow removal prices from lot size, walks and your own rates. Measure a lot from its address. Assumptions are editable and clearly labeled.',
  alternates: { canonical: '/tools/snow-removal-pricing-calculator' },
  openGraph: { title: 'Free snow removal pricing calculator', description: 'Per push, per event and seasonal estimates from your lot size and your rates.' },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'SoftwareApplication', name: 'Snow removal pricing calculator', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
    { '@type': 'HowTo', name: 'How to price snow removal', step: ['Measure the lot or enter its square footage', 'Add the length of walks', 'Set your own rates', 'Read the per push, per event and seasonal estimates'].map((text) => ({ '@type': 'HowToStep', text })) },
  ],
};

export default function Page() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-bold text-slate-900">Free snow removal pricing calculator</h1>
      <p className="mt-2 text-slate-700">Enter a lot size or measure one by address, then set your own rates. The rates start at placeholder assumptions. They are not market data, so change them to match your costs.</p>
      <Calculator />
      <h2 className="mt-10 text-xl font-semibold">How to charge for snow removal</h2>
      <p className="mt-2 text-slate-700">Most operators price by push, by storm, by inch tier or by the season. Work from your cost per hour and how fast you clear a lot. A calculator gives you a starting number, and your market and your equipment set the final one.</p>
    </section>
  );
}
