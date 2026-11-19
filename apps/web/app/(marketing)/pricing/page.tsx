import { buttonVariants, Card } from '@flake/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pricing', description: 'Free up to 25 sites with a 1% fee on payments, or Pro at $79 a month with unlimited sites and a 0.5% fee. Free first season through April 30, 2027.', alternates: { canonical: '/pricing' } };

const FREE = ['Up to 25 sites', 'Every core feature', '1% fee on payments through Flake (minimum $0.50, maximum $25 per payment)', 'Turn off online payments and pay nothing'];
const PRO = ['Unlimited sites', 'Subcontractor pay statements', 'QuickBooks Online export', '0.5% fee on payments (same $0.50 minimum and $25 maximum)'];

/** What an owner asks first (issue 153). */
const FAQ: [string, string][] = [
  ['Who pays for the texts?', 'Texts and emails are included on both plans. Flake sets up your company\'s own verified toll-free number and pays for it and for the texts it sends. Until the number is verified, drivers get their route link from the storm board\'s QR code or from your own phone.'],
  ['What counts as a site?', 'Each lot or property you plow, with its own address. A customer with three lots is three sites. Lots you retire don\'t count.'],
  ['What happens after April 30, 2027 if I have more than 25 sites?', 'Nothing is turned off or deleted. Every site you have keeps working, with its history. Adding or restoring a site past 25 needs Pro.'],
  ['Can I turn payments off?', 'Yes. Set a customer to Manual billing and Flake never charges them: you send the bill and record the check, and there\'s no Flake fee on it.'],
  ['Do my drivers need an app?', 'No. Each driver gets a link by text that opens in the phone\'s browser, works with no signal, and can be added to the home screen.'],
];

export default function Pricing() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-14">
      <h1 className="text-3xl font-bold text-ink">Pricing</h1>
      <Card className="mt-4 border-info-line bg-info-tint"><b>Free first season.</b> Early testers pay no Pro charge through April 30, 2027, and Pro features are on, including unlimited sites. After that the free plan covers 25 sites. The 1% payment fee still applies. It&apos;s how Flake makes money.</Card>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Free</h2>
          <p className="mt-1 text-3xl font-bold">$0</p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-2">{FREE.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold">Pro</h2>
          <p className="mt-1 text-3xl font-bold">$79<span className="text-base font-normal text-muted">/mo</span></p>
          <p className="text-sm text-muted">or $790 a year</p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-2">{PRO.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted" data-testid="stripe-fees">Card and bank payments also carry Stripe&apos;s own processing fees, which go to Stripe: card 2.9% + 30¢, bank (ACH) 0.8% capped at $5. Texts and email are included.</p>
      <Link href="/login" className={`${buttonVariants({ variant: 'accent', size: 'lg' })} mt-6`}>Start free</Link>
      <h2 className="mt-12 text-2xl font-semibold text-ink">Questions</h2>
      <dl className="mt-4 space-y-4" data-testid="pricing-faq">
        {FAQ.map(([q, a]) => (
          <div key={q}>
            <dt className="font-semibold text-ink">{q}</dt>
            <dd className="mt-1 text-ink-2">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
