import { profitOf, share, type LotCosts, type LotProfit } from '@flake/core/profit';
import { saltTons } from '@flake/core/reports';
import { subPayStatement, type SubRateCard } from '@flake/core/subpay';
import { and, contract, crew_member, customer, eq, equipment_log, gte, inArray, installment_invoice, invoice_draft, isNotNull, lt, site, sql, storm, type Tx } from '@flake/db';
import { saltCostPerTon } from './yards';

export interface ProfitRow extends LotProfit { label: string; customer: string; customer_id: string; visits: number; minutes: number; /** Bills drafted for this lot but not approved yet, so its revenue isn't counted (issue 211). */ unapproved_cents: number }
export interface ProfitResult { rows: ProfitRow[]; totals: LotProfit; missing: string[]; storms: number }

type Line = { site_id?: string; amount_cents: number };
type VisitRow = { id: string; site_id: string; storm_id: string; crew_id: string; arrived: string; departed: string | null; salt: { unit: string; qty: number }[] | null };

/**
 * Profit per lot for storms that started in [startAt, endAt), or one storm (issue 167). Rules are in
 * packages/core/src/profit.ts and on the page.
 */
export async function profitReport(tx: Tx, tenantId: string, opts: { startAt: string; endAt: string; stormId?: string | null; collectedOnly?: boolean; minMarginPct?: number | null }): Promise<ProfitResult> {
  const storms = await tx.select({ id: storm.id }).from(storm).where(opts.stormId ? eq(storm.id, opts.stormId) : and(gte(storm.started_at, opts.startAt), lt(storm.started_at, opts.endAt)));
  const stormIds = storms.map((s) => s.id);
  const costs = new Map<string, LotCosts>();
  const lot = (id: string) => costs.get(id) ?? (costs.set(id, { siteId: id, revenue_cents: 0, labor_cents: 0, sub_cents: 0, salt_cents: 0, equipment_cents: 0 }), costs.get(id)!);
  const missing = new Set<string>();
  const unapproved = new Map<string, number>();

  // Revenue: storm bill lines, and seasonal installments billed in the period.
  if (stormIds.length) {
    const drafts = await tx.select({ lines: invoice_draft.lines }).from(invoice_draft).where(and(inArray(invoice_draft.storm_id, stormIds), inArray(invoice_draft.status, opts.collectedOnly ? ['paid'] : ['approved', 'charged', 'sent', 'paid', 'failed'])));
    for (const d of drafts) for (const l of d.lines as Line[]) if (l.site_id) lot(l.site_id).revenue_cents += l.amount_cents;
    const waiting = await tx.select({ lines: invoice_draft.lines }).from(invoice_draft).where(and(inArray(invoice_draft.storm_id, stormIds), eq(invoice_draft.status, 'draft')));
    for (const d of waiting) for (const l of d.lines as Line[]) if (l.site_id) unapproved.set(l.site_id, (unapproved.get(l.site_id) ?? 0) + l.amount_cents);
  }
  if (!opts.stormId) {
    const inst = await tx.select({ site_id: contract.site_id, cents: installment_invoice.amount_cents }).from(installment_invoice).innerJoin(contract, eq(contract.id, installment_invoice.contract_id))
      .where(and(gte(installment_invoice.created_at, opts.startAt), lt(installment_invoice.created_at, opts.endAt), inArray(installment_invoice.status, opts.collectedOnly ? ['paid'] : ['manual', 'sent', 'failed', 'paid'])));
    for (const i of inst) lot(i.site_id).revenue_cents += i.cents;
  }

  // Visits in those storms, as corrected in review; voided ones left out.
  const visits = stormIds.length ? (await tx.execute(sql`
    select v.id, v.site_id, v.storm_id, v.crew_id, v.arrived_device_at as arrived, v.departed_device_at as departed,
      coalesce((select c.new_value from visit_correction c where c.visit_id = v.id and c.field = 'salt' order by c.created_at desc limit 1), v.salt) as salt
    from visit v
    where v.storm_id in (${sql.join(stormIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)`)) as unknown as VisitRow[] : [];
  const minutesOf = (v: VisitRow) => (v.departed ? Math.max(0, (new Date(v.departed).getTime() - new Date(v.arrived).getTime()) / 60_000) : 0);
  const crew = new Map((await tx.select().from(crew_member)).map((c) => [c.id, c]));
  const costPerTon = await saltCostPerTon(tenantId);
  const visitCount = new Map<string, number>();
  const minutes = new Map<string, number>();
  for (const v of visits) {
    const c = lot(v.site_id);
    const m = minutesOf(v);
    visitCount.set(v.site_id, (visitCount.get(v.site_id) ?? 0) + 1);
    minutes.set(v.site_id, (minutes.get(v.site_id) ?? 0) + m);
    const who = crew.get(v.crew_id);
    if (who?.kind === 'employee') {
      const rate = who.pay_storm_cents ?? who.pay_regular_cents;
      if (rate == null) missing.add(`pay rate for ${who.name}`);
      else c.labor_cents += Math.round((rate * m) / 60);
    }
    const tons = (v.salt ?? []).reduce((n, e) => n + (saltTons(e.unit, Number(e.qty)) ?? 0), 0);
    if (tons) {
      if (costPerTon == null) missing.add('salt cost (add a delivery with its cost in Salt yards)');
      else c.salt_cents += Math.round(tons * costPerTon);
    }
  }

  // Subs: Sub pay's own numbers per visit; a flat per-storm rate shared across the sub's lots in that storm.
  for (const [crewId, who] of crew) {
    if (who.kind !== 'sub') continue;
    for (const stormId of stormIds) {
      const mine = visits.filter((v) => v.crew_id === crewId && v.storm_id === stormId);
      if (!mine.length) continue;
      const st = subPayStatement(who.sub_rate_card as SubRateCard | null, mine.map((v) => ({ id: v.id, site_label: '', arrived_at: new Date(v.arrived).toISOString(), departed_at: v.departed ? new Date(v.departed).toISOString() : null, salt: v.salt })));
      for (const l of st.lines) {
        if (l.visit_id) lot(mine.find((v) => v.id === l.visit_id)!.site_id).sub_cents += l.amount_cents;
        else for (const [siteId, cents] of share(l.amount_cents, new Map(mine.map((v) => [v.site_id, 1])))) lot(siteId).sub_cents += cents;
      }
    }
  }

  // Equipment: fuel and maintenance logged against a storm, shared by time on site across that storm's lots.
  if (stormIds.length) {
    const eq = await tx.select({ storm_id: equipment_log.storm_id, cents: sql<number>`sum(${equipment_log.cost_cents})::int` }).from(equipment_log).where(and(inArray(equipment_log.storm_id, stormIds), isNotNull(equipment_log.cost_cents))).groupBy(equipment_log.storm_id);
    for (const e of eq) {
      const weights = new Map<string, number>();
      for (const v of visits.filter((x) => x.storm_id === e.storm_id)) weights.set(v.site_id, (weights.get(v.site_id) ?? 0) + minutesOf(v));
      for (const [siteId, cents] of share(e.cents, weights)) lot(siteId).equipment_cents += cents;
    }
  }

  const ids = [...costs.keys()];
  const names = ids.length ? await tx.select({ id: site.id, label: site.label, customer: customer.name, customer_id: customer.id }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).where(inArray(site.id, ids)) : [];
  const rows: ProfitRow[] = ids.map((id) => {
    const n = names.find((x) => x.id === id);
    const p = profitOf(costs.get(id)!, { minMarginPct: opts.minMarginPct });
    const waiting = unapproved.get(id) ?? 0;
    // A lot whose only bill is waiting for approval isn't losing money yet; it just isn't billed.
    return { ...p, losing: p.losing && !(waiting && !p.revenue_cents), unapproved_cents: waiting, label: n?.label ?? 'Removed lot', customer: n?.customer ?? '', customer_id: n?.customer_id ?? '', visits: visitCount.get(id) ?? 0, minutes: Math.round(minutes.get(id) ?? 0) };
  }).sort((a, b) => a.profit_cents - b.profit_cents);
  const sum = (k: keyof LotCosts) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const totals = profitOf({ siteId: 'all', revenue_cents: sum('revenue_cents'), labor_cents: sum('labor_cents'), sub_cents: sum('sub_cents'), salt_cents: sum('salt_cents'), equipment_cents: sum('equipment_cents') });
  return { rows, totals, missing: [...missing], storms: stormIds.length };
}
