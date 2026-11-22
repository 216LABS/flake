import Link from 'next/link';
import type { ReactNode } from 'react';

/** The shared shape of a free tool page (issue 237): the tool, a short explainer, an FAQ with schema.org markup, a soft CTA. */
export function ToolPage({ title, intro, name, steps, faq, children, explainer }: { title: string; intro: string; name: string; steps: string[]; faq: [string, string][]; children: ReactNode; explainer: ReactNode }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'SoftwareApplication', name, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
      { '@type': 'HowTo', name: `How to use the ${name.toLowerCase()}`, step: steps.map((text) => ({ '@type': 'HowToStep', text })) },
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  };
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-ink-2">{intro}</p>
      {children}
      <div className="mt-10 space-y-3 text-ink-2">{explainer}</div>
      <h2 className="mt-10 text-xl font-semibold">Questions</h2>
      <dl className="mt-3 space-y-4">
        {faq.map(([q, a]) => (
          <div key={q}><dt className="font-semibold text-ink">{q}</dt><dd className="mt-1 text-ink-2">{a}</dd></div>
        ))}
      </dl>
      <div className="mt-10 rounded-md border border-line-faint bg-surface p-4" data-testid="tool-cta">
        <p className="font-semibold text-ink">Do this automatically in Flake</p>
        <p className="mt-1 text-sm text-ink-2">Flake builds bills and service logs from what your drivers record on their phones, with times, GPS and photos. It&apos;s free for the 2026-27 season.</p>
        <Link href="/login" className="mt-2 inline-block font-medium text-link underline underline-offset-2">Try Flake free</Link>
      </div>
    </section>
  );
}
