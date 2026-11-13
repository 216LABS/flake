import { buttonVariants, Card } from '@flake/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pricing', description: 'Free up to 25 sites with a 1% fee on payments, or Pro at $79 a month with unlimited sites and a 0.5% fee. Free first season through April 30, 2027.', alternates: { canonical: '/pricing' } };

const FREE = ['Up to 25 sites', 'Every core feature', '1% fee on payments through Flake (minimum $0.50, maximum $25 per payment)', 'Turn off online payments and pay nothing'];
const PRO = ['Unlimited sites', 'Subcontractor pay statements', 'QuickBooks Online export', '0.5% fee on payments (same $0.50 minimum and $25 maximum)'];

export default function Pricing() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-14">
      <h1 className="text-3xl font-bold text-ink">Pricing</h1>
      <p className="mt-2 text-ink-2">Stripe&apos;s own processing fees go to Stripe and are separate: card 2.9% + 30¢, bank (ACH) 0.8% capped at $5.</p>
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
      <Link href="/login" className={`${buttonVariants({ variant: 'accent', size: 'lg' })} mt-6`}>Start free</Link>
    </section>
  );
}
