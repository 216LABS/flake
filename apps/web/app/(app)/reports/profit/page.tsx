import { quotingSeason, zonedDayStart } from '@flake/core/time';
import { desc, storm } from '@flake/db';
import { Badge, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { money } from '@/lib/client';
import { profitReport } from '@/lib/profit';

export const metadata = { title: 'Profit per lot' };

/** A season runs July 1 to June 30, so one winter is one row of numbers. */
function seasonRange(season: string, tz: string) {
  const y = Number(season.slice(0, 4));
  return { startAt: zonedDayStart(`${y}-07-01`, tz).toISOString(), endAt: zonedDayStart(`${y + 1}-07-01`, tz).toISOString() };
}

/** What each lot earned less what it cost, worst first (issue 167). */
export default async function Profit({ searchParams }: { searchParams: Promise<{ season?: string; storm?: string; collected?: string; margin?: string }> }) {
  const ctx = await requirePage();
  if (ctx.role === 'viewer') return <><PageHeader title="Profit per lot" /><Card className="max-w-2xl"><p className="text-sm">Profit shows pay and costs, so only owners and dispatchers can open it.</p></Card></>;
  const q = await searchParams;
  const tz = ctx.tenant.timezone;
  const season = q.season && /^\d{4}-\d{2}$/.test(q.season) ? q.season : quotingSeason(new Date(), tz);
  const margin = q.margin && Number(q.margin) > 0 && Number(q.margin) < 100 ? Number(q.margin) : null;
  const { startAt, endAt } = seasonRange(season, tz);
  const data = await asUser(ctx, async (tx) => ({
    storms: await tx.select({ id: storm.id, name: storm.name, started_at: storm.started_at }).from(storm).orderBy(desc(storm.started_at)).limit(60),
    report: await profitReport(tx, ctx.tenantId, { startAt, endAt, stormId: q.storm || null, collectedOnly: q.collected === '1', minMarginPct: margin }),
  }));
  const r = data.report;
  const pct = (m: number | null) => (m == null ? '-' : `${m}%`);
  const y = Number(season.slice(0, 4));
  return (
    <>
      <PageHeader title="Profit per lot" subtitle="What each lot earned, less labor, subs, salt and equipment. Money-losing lots first." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" data-testid="profit-filters">
        <div><Label htmlFor="season">Season</Label><Select id="season" name="season" defaultValue={season} className="w-auto">{[y + 1, y, y - 1, y - 2].map((s) => { const v = `${s}-${String((s + 1) % 100).padStart(2, '0')}`; return <option key={v} value={v}>{s}-{String((s + 1) % 100).padStart(2, '0')}</option>; })}</Select></div>
        <div><Label htmlFor="storm">Or one storm</Label><Select id="storm" name="storm" defaultValue={q.storm ?? ''} className="w-auto max-w-64"><option value="">The whole season</option>{data.storms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div><Label htmlFor="margin">Flag under margin (%)</Label><Input id="margin" name="margin" type="number" min={1} max={99} defaultValue={margin ?? ''} className="w-24" /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="collected" value="1" defaultChecked={q.collected === '1'} /> Collected only</label>
        <button type="submit" className="h-10 rounded-md border px-3 text-sm font-semibold">Show</button>
      </form>
      {r.missing.length ? <p className="mb-3 rounded-md bg-warn-tint p-3 text-sm text-warn-ink" data-testid="profit-missing">Counted as $0 because it isn&apos;t set: {r.missing.join('; ')}.</p> : null}
      {r.rows.length ? (
        <>
          <Card className="mb-4 max-w-3xl" data-testid="profit-totals">
            <p className="text-sm">{r.storms} {r.storms === 1 ? 'storm' : 'storms'}. Revenue <b className="tabular">{money(r.totals.revenue_cents)}</b>, costs <b className="tabular">{money(r.totals.cost_cents)}</b>, profit <b className={`tabular ${r.totals.profit_cents < 0 ? 'text-danger' : ''}`}>{money(r.totals.profit_cents)}</b> ({pct(r.totals.margin)}). {r.rows.filter((x) => x.losing).length} {r.rows.filter((x) => x.losing).length === 1 ? 'lot is' : 'lots are'} flagged.</p>
          </Card>
          <Table stack data-testid="profit-table">
            <thead><tr><Th>Lot</Th><Th className="text-right">Revenue</Th><Th className="text-right">Labor</Th><Th className="text-right">Subs</Th><Th className="text-right">Salt</Th><Th className="text-right">Equipment</Th><Th className="text-right">Profit</Th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.siteId} data-testid="profit-row">
                  <Td className="wrap-anywhere"><Link className="font-medium text-link underline" href={`/sites/${x.siteId}`}>{x.label}</Link><span className="block text-xs text-muted">{x.customer}, {x.visits} {x.visits === 1 ? 'visit' : 'visits'}, {x.minutes} min on site</span>{x.losing ? <Badge tone="red" data-testid="profit-losing">{x.profit_cents < 0 ? 'Losing money' : 'Under margin'}</Badge> : null}</Td>
                  <Td label="Revenue" className="text-right tabular">{money(x.revenue_cents)}</Td>
                  <Td label="Labor" className="text-right tabular">{money(x.labor_cents)}</Td>
                  <Td label="Subs" className="text-right tabular">{money(x.sub_cents)}</Td>
                  <Td label="Salt" className="text-right tabular">{money(x.salt_cents)}</Td>
                  <Td label="Equipment" className="text-right tabular">{money(x.equipment_cents)}</Td>
                  <Td label="Profit" className={`text-right tabular font-semibold ${x.profit_cents < 0 ? 'text-danger' : ''}`} data-testid="profit-value">{money(x.profit_cents)} <span className="text-xs font-normal text-muted">{pct(x.margin)}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : <EmptyState title="Nothing billed or plowed in this range" />}
      <details className="mt-4 max-w-3xl text-sm text-ink-2">
        <summary className="cursor-pointer font-semibold">How these are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Revenue: bill lines for the lot from storms in the range, approved or later, plus seasonal installments billed in the range. Unpaid bills count unless Collected only is ticked.</li>
          <li>Labor: each employee&apos;s time on site times their storm rate, or regular rate. Drive time between lots isn&apos;t counted yet.</li>
          <li>Subs: what Sub pay pays for each visit; a flat rate per storm is split across that sub&apos;s lots in the storm.</li>
          <li>Salt: tons spread times the average cost per ton of deliveries with a cost (Salt yards).</li>
          <li>Equipment: fuel and maintenance logged against a storm, split across that storm&apos;s lots by time on site.</li>
          <li>A season runs July 1 to June 30.</li>
        </ul>
      </details>
      <Link className="mt-4 inline-block text-sm text-link underline" href="/reports">Back to reports</Link>
    </>
  );
}
