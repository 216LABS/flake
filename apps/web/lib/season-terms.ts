import { currentSeason } from '@flake/core/time';
import { and, asService, contract, customer, eq, gte, installment_invoice, invoice_draft, notInArray, site, sql, storm, type Tx } from '@flake/db';
import { HttpError } from './http';

/**
 * Season-to-date against the contract's own terms (issue 233): pushes used against a seasonal cap, and storm billing
 * against a per-push seasonal minimum, so a low-snow year isn't a surprise in March. A minimum's shortfall can be drafted
 * as a "true-up" for the office to review: an installment row in 'draft' status that no job sends and no customer sees
 * until the office approves it.
 */
export interface SeasonTermRow {
  contract_id: string; site_id: string; site: string; customer: string;
  pushes: number; included: number | null;
  billed_cents: number; minimum_cents: number | null;
  trueup: { id: string; status: string; amount_cents: number } | null;
}

const trueUpPeriod = (season: string) => `trueup-${season}`;

export async function seasonTerms(tx: Tx, tz: string, now = new Date()): Promise<{ season: string; rows: SeasonTermRow[] }> {
  const season = currentSeason(now, tz);
  const from = `${season.slice(0, 4)}-07-01`;
  const contracts = await tx.select({ k: contract, site, customer }).from(contract).innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id))
    .where(and(eq(contract.status, 'accepted'), eq(contract.season, season)));
  const rows: SeasonTermRow[] = [];
  for (const { k, site: st, customer: c } of contracts) {
    const plow = ((k.services ?? []) as { service: string; pricing?: { type: string; included_pushes?: number | null; season_min_cents?: number | null } | null }[]).find((x) => x.service === 'plow');
    const included = plow?.pricing?.type === 'seasonal' ? plow.pricing.included_pushes ?? null : null;
    const minimum = plow?.pricing?.type === 'per_push' ? plow.pricing.season_min_cents ?? null : null;
    if (!included && !minimum) continue;
    const [p] = (await tx.execute(sql`
      select count(*)::int as n from visit v join storm s on s.id = v.storm_id
      where v.site_id = ${st.id} and v.departed_device_at is not null and s.started_at >= ${from}::date and 'plow' = any(v.services)
        and not exists (select 1 from visit_correction vc where vc.visit_id = v.id and vc.field = 'voided' and vc.new_value = 'true'::jsonb)`)) as unknown as { n: number }[];
    // Storm bills for this lot this season, approved or later: the lines for this site, not the customer's whole bill.
    const drafts = await tx.select({ lines: invoice_draft.lines }).from(invoice_draft).innerJoin(storm, eq(storm.id, invoice_draft.storm_id))
      .where(and(eq(invoice_draft.customer_id, c.id), notInArray(invoice_draft.status, ['draft', 'void']), gte(storm.started_at, `${from}T00:00:00Z`)));
    const billed = drafts.flatMap((d) => (d.lines as { site_id?: string; amount_cents: number }[]).filter((l) => l.site_id === st.id)).reduce((a, l) => a + l.amount_cents, 0);
    const [t] = await tx.select({ id: installment_invoice.id, status: installment_invoice.status, amount_cents: installment_invoice.amount_cents }).from(installment_invoice).where(and(eq(installment_invoice.contract_id, k.id), eq(installment_invoice.period, trueUpPeriod(season))));
    rows.push({ contract_id: k.id, site_id: st.id, site: st.label, customer: c.name, pushes: p?.n ?? 0, included, billed_cents: billed, minimum_cents: minimum, trueup: t ?? null });
  }
  return { season, rows: rows.sort((a, b) => a.customer.localeCompare(b.customer) || a.site.localeCompare(b.site)) };
}

/** Drafts the shortfall under a per-push seasonal minimum, for review. Never sent, charged or shown until approved. */
export async function draftTrueUp(tx: Tx, tenantId: string, tz: string, contractId: string) {
  const { season, rows } = await seasonTerms(tx, tz);
  const r = rows.find((x) => x.contract_id === contractId);
  if (!r || !r.minimum_cents) throw new HttpError(404, 'That contract has no seasonal minimum this season.');
  const short = r.minimum_cents - r.billed_cents;
  if (short <= 0) throw new HttpError(409, 'Billing this season already meets the minimum.', 'minimum_met');
  if (r.trueup) throw new HttpError(409, 'A true-up is already drafted for this lot this season.', 'trueup_exists');
  const [row] = await asService(tx, tenantId, () => tx.insert(installment_invoice).values({ tenant_id: tenantId, contract_id: contractId, seq: 900, amount_cents: short, status: 'draft', period: trueUpPeriod(season) }).returning());
  return row!;
}

/** Approving makes it an ordinary bill the office sends (status manual); discarding removes the draft. */
export async function decideTrueUp(tx: Tx, tenantId: string, id: string, approve: boolean) {
  const [row] = await tx.select({ id: installment_invoice.id, status: installment_invoice.status, period: installment_invoice.period }).from(installment_invoice).where(eq(installment_invoice.id, id));
  if (!row || !row.period?.startsWith('trueup-')) throw new HttpError(404, 'True-up not found');
  if (row.status !== 'draft') throw new HttpError(409, 'This true-up was already decided.', 'decided');
  if (approve) await asService(tx, tenantId, () => tx.update(installment_invoice).set({ status: 'manual' }).where(and(eq(installment_invoice.id, id), eq(installment_invoice.status, 'draft'))));
  else await asService(tx, tenantId, () => tx.delete(installment_invoice).where(and(eq(installment_invoice.id, id), eq(installment_invoice.status, 'draft'))));
  return { ok: true };
}
