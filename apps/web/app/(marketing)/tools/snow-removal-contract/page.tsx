import type { Metadata } from 'next';
import { ContractBuilder } from './contract-builder';

export const metadata: Metadata = {
  title: 'Free Snow Removal Contract Template Builder (PDF)',
  description: 'Build a snow removal contract in minutes: services, trigger depth, per push, per inch, per event or seasonal pricing, salt, insurance and payment terms. Download a PDF with no account.',
  alternates: { canonical: '/tools/snow-removal-contract' },
  openGraph: { title: 'Free snow removal contract builder', description: 'Make a snow plowing contract PDF with no account.' },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'SoftwareApplication', name: 'Snow removal contract builder', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
    { '@type': 'HowTo', name: 'How to make a snow removal contract', step: ['Enter your company, client and site', 'Choose services, trigger depth and pricing', 'Add salt, insurance and payment terms', 'Download the PDF and have an attorney review it'].map((text) => ({ '@type': 'HowToStep', text })) },
  ],
};

export default function Page() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-bold text-slate-900">Free snow removal contract builder</h1>
      <p className="mt-2 text-slate-700">Fill this in and download a PDF. There&apos;s no account, and the email is optional. This is a starting template and not legal advice, so have an attorney review it for your state.</p>
      <ContractBuilder />
      <h2 className="mt-10 text-xl font-semibold">What a snow plowing contract should cover</h2>
      <p className="mt-2 text-slate-700">Write down what triggers service, how it&apos;s priced, how salt is billed, who carries which insurance, and when payment is due. Most disputes after a storm come from one of those five being vague.</p>
    </section>
  );
}
