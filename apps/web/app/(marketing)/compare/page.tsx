import { buttonVariants, Card } from '@flake/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AS_OF, PRICES, PRODUCTS, ROWS, SOURCES } from '@/lib/compare';
import { CellView } from './cell';
import { PhoneGrid } from './phone-grid';

export const metadata: Metadata = {
  title: 'Compare snow plow software',
  description: 'Flake compared with Jobber, Yeti, Service Autopilot and Plowdesk for small plow companies, from each vendor\'s public pages.',
  alternates: { canonical: '/compare' },
};

/** Issue 181: a public, sourced comparison. The grid's data lives in lib/compare.ts. */
export default function Compare() {
  return (
    <>
      <section className="bg-slate-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight md:text-5xl">Built for snow, not adapted to it.</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">Flake compared with Jobber, Yeti, Service Autopilot and Plowdesk, for small plow companies. Every cell comes from each company&apos;s own website. Where we couldn&apos;t confirm something, it says Unverified.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/login" className={buttonVariants({ variant: 'accent', size: 'lg' })}>Start free</Link>
            <Link href="/pricing" className={buttonVariants({ variant: 'outline', size: 'lg' })}>See pricing</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" data-testid="compare-key">
          <span><span className="font-semibold text-ok-ink">✓ Yes</span>: on its public pages</span>
          <span>– No: its pages say otherwise</span>
          <span><b>Partial</b> or <b>Add-on</b>: limited, or costs extra</span>
          <span><b>Unverified</b>: not confirmed from public pages</span>
        </p>
        <PhoneGrid />
        <div className="hidden overflow-x-auto rounded-md border border-line-faint bg-surface md:block" data-testid="compare-table">
          <table className="w-full min-w-[56rem] border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-56 border-b border-line-faint bg-tint-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Feature</th>
                {PRODUCTS.map((p) => <th key={p} scope="col" className={`border-b border-line-faint px-3 py-2 text-sm font-semibold ${p === 'Flake' ? 'bg-info-tint text-ink' : 'bg-tint-2 text-ink'}`}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.feature} data-testid="compare-row">
                  <th scope="row" className="sticky left-0 z-10 border-b border-line-faint bg-surface px-3 py-2.5 align-top text-sm font-medium text-ink">{r.feature}</th>
                  {PRODUCTS.map((p) => <td key={p} className={`border-b border-line-faint px-3 py-2.5 align-top ${p === 'Flake' ? 'bg-info-tint/40' : ''}`}><CellView cell={r.cells[p]} /></td>)}
                </tr>
              ))}
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2.5 align-top text-sm font-medium text-ink">Published price</th>
                {PRODUCTS.map((p) => <td key={p} className={`px-3 py-2.5 align-top text-xs leading-snug text-ink-2 ${p === 'Flake' ? 'bg-info-tint/40' : ''}`}>{PRICES[p]}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-y border-line-faint bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Built for snow, not adapted to it</h2>
          <div className="mt-4 space-y-3 text-ink-2">
            <p>Jobber is general field-service software. Its snow workflow is to create visits when it snows, and per-inch pricing means a separate job for each depth band. Service Autopilot is lawn and landscape software with a snow dispatch module from its Pro plan.</p>
            <p>Yeti and Plowdesk are built for snow, like Flake. Both need a crew app on every phone. Yeti sells weather reporting as an add-on and doesn&apos;t list per-inch pricing. Plowdesk&apos;s free plan stops at 3 storm routes.</p>
            <p>Flake drivers open a link: nothing to install, no login, and it keeps working with no signal. Flake tells you when a contract&apos;s trigger depth is coming, keeps the forecast you relied on with the visit record, bills per inch natively, and gives you Gusto and ADP payroll files.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="font-display text-3xl font-semibold tracking-tight">What it costs</h2>
        <Card className="mt-4 border-info-line bg-info-tint" data-testid="compare-flake-price">
          <b>Flake is free for early testers through April 30, 2027</b>, with Pro features on, including unlimited sites. After that, Free covers up to 25 sites, or Pro is $79 a month ($790 a year). Flake charges 1% on payments processed through it (0.5% on Pro), with a $0.50 minimum and a $25 maximum, and Stripe&apos;s own processing fees apply too. Bill a customer by hand and there&apos;s no Flake fee.
        </Card>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          {PRODUCTS.filter((p) => p !== 'Flake').map((p) => <li key={p}><b className="text-ink">{p}:</b> {PRICES[p]}</li>)}
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants({ variant: 'accent', size: 'lg' })}>Start free</Link>
          <Link href="/pricing" className={buttonVariants({ variant: 'outline', size: 'lg' })}>Flake pricing</Link>
        </div>

        <details className="mt-10 rounded-md border border-line-faint bg-surface p-4" data-testid="compare-sources">
          <summary className="cursor-pointer font-semibold text-ink">Sources</summary>
          <div className="mt-3 space-y-3 text-sm">
            {SOURCES.map((s) => (
              <div key={s.product}>
                <p className="font-semibold text-ink">{s.product}</p>
                <ul className="mt-1 space-y-1">
                  {s.links.map(([label, href]) => <li key={href}><a className="break-all text-link underline underline-offset-2" href={href}>{label}</a></li>)}
                </ul>
              </div>
            ))}
          </div>
        </details>
        <p className="mt-6 text-xs text-muted" data-testid="compare-footnote">{AS_OF} Product names belong to their owners; this page isn&apos;t endorsed by any of them.</p>
      </section>
    </>
  );
}
