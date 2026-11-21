import { Card, Eyebrow, PageHeader, Stat, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { ButtonA, entityLink } from '@/components/links';
import { requirePage } from '@/lib/auth';
import { contractorSalt, saltOrderingReady } from '@/lib/salt-orders';
import { saltPlan } from '@/lib/salt-plan';
import { yardStock } from '@/lib/yards';
import { SaltOrder } from '../reports/salt-order';
import { SeasonEvents } from './season-events';
import { YardsPanel } from './yards-panel';

export const metadata = { title: 'Salt' };

const t = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} t`);

/**
 * Salt, in one place (issue 197, phase 1): on hand by yard, storms of cover, what the next forecast storm needs, a
 * pre-season estimate, ordering, and what each lot used.
 */
export default async function Salt() {
  const ctx = await requirePage();
  const [plan, yards] = await Promise.all([saltPlan(ctx.tenantId), yardStock(ctx.tenantId)]);
  const ordering = ctx.role !== 'viewer' && (await saltOrderingReady()) ? await contractorSalt(ctx) : null;
  const a = ctx.tenant.address as { line1?: string; city?: string; state?: string; zip?: string } | null;
  const address = a ? [a.line1, a.city, a.state, a.zip].filter(Boolean).join(', ') : '';
  return (
    <>
      <PageHeader title="Salt" subtitle="What you have, what the next storm needs, and what each lot uses. Bags count as 50 lb." actions={ordering ? <ButtonA variant="accent" href="#order" data-testid="order-salt">Order salt</ButtonA> : null} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="salt-summary">
        <Card><Stat label="On hand" value={plan.on_hand === null ? 'Not counted' : t(plan.on_hand)} note={plan.on_hand === null ? 'Count a pile below to start' : `Across ${yards.length === 1 ? '1 yard' : `${yards.length} yards`}`} /></Card>
        <Card data-testid="salt-next-storm">
          {plan.next_storm ? (
            <Stat label="Next storm needs" value={`~${t(plan.next_storm.need_tons)}`} note={plan.next_storm.short_tons ? `${plan.next_storm.lots} salt lot${plan.next_storm.lots === 1 ? '' : 's'} with snow coming. Order ${Math.ceil(plan.next_storm.short_tons)}+ t.` : `${plan.next_storm.lots} salt lot${plan.next_storm.lots === 1 ? '' : 's'} with snow coming. ${plan.on_hand === null ? 'Count your pile to know if you have enough.' : 'You have enough.'}`} />
          ) : <Stat label="Next storm needs" value="Nothing yet" note="No snow in the next 12 hours at your salt lots" />}
        </Card>
        <Card><Stat label="Used this season" value={t(plan.used_this_season)} note={`Season ${plan.season}`} /></Card>
        <Card data-testid="salt-season-estimate"><Stat label="Season estimate" value={`~${t(plan.season_estimate.tons)}`} note={`${plan.season_estimate.salt_lots} salt lots × ${plan.season_estimate.events} salt runs`} />{ctx.role === 'owner' ? <SeasonEvents events={plan.season_estimate.events} /> : null}</Card>
      </div>
      {plan.next_storm?.short_tons ? <p className="mb-4 rounded-md border border-warn-line bg-warn-tint p-3 text-sm font-medium text-warn-ink" data-testid="salt-short">Need about {t(plan.next_storm.need_tons)} for the next storm and you have {t(plan.on_hand)}. Order {Math.ceil(plan.next_storm.short_tons)} t or more.</p> : null}

      <section aria-labelledby="yards-title" className="mb-6">
        <Eyebrow id="yards-title" className="mb-2">Yards</Eyebrow>
        <p className="mb-2 text-sm text-muted">On hand = the last count, plus deliveries and adjustments since, minus what drivers logged on lots since.</p>
        <YardsPanel yards={JSON.parse(JSON.stringify(yards))} tz={ctx.tenant.timezone} readOnly={ctx.role === 'viewer'} />
      </section>

      {ordering ? (
        <section id="order" aria-labelledby="order-title" className="mb-6 scroll-mt-20">
          <Eyebrow id="order-title" className="mb-2">Order salt</Eyebrow>
          <SaltOrder initial={JSON.parse(JSON.stringify(ordering))} defaultAddress={address} canOrder={ctx.role !== 'viewer'} />
        </section>
      ) : null}

      <section aria-labelledby="use-title">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <Eyebrow id="use-title">Use by lot, season {plan.season}</Eyebrow>
          {plan.lots.length ? <ButtonA size="sm" href="/api/salt/usage.csv" download data-testid="salt-usage-csv">Download CSV</ButtonA> : null}
        </div>
        {plan.lots.length ? (
          <Table stack data-testid="salt-lots">
            <thead><tr><Th>Lot</Th><Th className="text-right">Storms</Th><Th className="text-right">Used</Th><Th className="text-right">Per salting</Th><Th className="text-right">Per 1,000 sq ft</Th></tr></thead>
            <tbody>
              {plan.lots.map((l) => (
                <tr key={l.site_id} data-testid="salt-lot">
                  <Td className="wrap-anywhere"><Link className={entityLink} href={`/sites/${l.site_id}`}>{l.label}</Link>{l.sqft ? <span className="block text-xs text-muted">{l.sqft.toLocaleString()} sq ft</span> : null}</Td>
                  <Td label="Storms" className="tabular text-right">{l.storms}</Td>
                  <Td label="Used" className="tabular text-right">{t(l.tons)}</Td>
                  <Td label="Per salting" className="tabular text-right">{l.per_event === null ? '-' : t(l.per_event)}{l.per_event_from === 'size' ? <span className="block text-xs text-muted">from lot size</span> : null}</Td>
                  <Td label="Per 1,000 sq ft" className="tabular text-right">{l.per_1000_sqft === null ? '-' : t(l.per_1000_sqft)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="rounded-md bg-tint p-3 text-sm text-ink-2" data-testid="salt-no-lots">No lots have salt on their contract yet. Add salt to a lot&apos;s quote and drivers can log it on each visit.</p>}
        <p className="mt-2 text-xs text-muted">Per 1,000 sq ft helps spot over-salting: a lot far above the others is worth a look. A lot with no salting yet is estimated from its size at about a ton an acre.</p>
      </section>
    </>
  );
}
