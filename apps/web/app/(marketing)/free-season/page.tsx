import { FREE_SEASON_END, seasonLabel } from '@flake/core/fees';
import { buttonVariants, Card } from '@flake/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { longDate } from '@/lib/legal';

const SEASON = seasonLabel();

export const metadata: Metadata = {
  title: `Free for the ${SEASON} season`,
  description: `Flake is free for the ${SEASON} snow season: every feature on, unlimited sites, no card needed.`,
  alternates: { canonical: '/free-season' },
};

/**
 * Issue 182: no plans or prices while next season's pricing is being worked out. /pricing redirects here. The fee on
 * payments through Flake is still real, so it is mentioned, with where its amount is shown, rather than hidden.
 */
const FAQ: [string, string][] = [
  ['What counts as a site?', 'Each lot or property you plow, with its own address. A customer with three lots is three sites. Lots you retire don\'t count. This season there\'s no limit on sites.'],
  ['Do my drivers need an app?', 'No. Each driver gets a link by text that opens in the phone\'s browser, works with no signal, and can be added to the home screen. Until your text number is verified, drivers get the link from the storm board\'s QR code or from your own phone.'],
  ['Who pays for the texts?', 'Flake does. It sets up your company\'s own verified toll-free number and pays for it and for the texts it sends.'],
  ['Can I turn payments off?', 'Yes. Set a customer to Manual billing and Flake never charges them: you send the bill and record the check. Card and bank payments through Flake carry Stripe\'s processing fees and a small Flake fee, and both are shown on each bill before you send it.'],
  ['What happens after the season?', 'Pricing for next season will be announced before it starts, and nobody is charged without agreeing first. Your sites, records and history stay yours either way.'],
];

export default function FreeSeason() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-bold text-ink">Free for the {SEASON} season</h1>
      <Card className="mt-4 border-info-line bg-info-tint" data-testid="free-season-card">
        Every feature is on, with unlimited sites, through {longDate(FREE_SEASON_END)}. No card needed. Pricing for next season will be announced before it starts, and nobody is charged without agreeing first.
      </Card>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/login" className={buttonVariants({ variant: 'accent', size: 'lg' })}>Start free</Link>
        <Link href="/compare" className={buttonVariants({ variant: 'outline', size: 'lg' })}>Compare Flake</Link>
      </div>
      <h2 className="mt-12 text-2xl font-semibold text-ink">Questions</h2>
      <dl className="mt-4 space-y-4" data-testid="free-season-faq">
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
