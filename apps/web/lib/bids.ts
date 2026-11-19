import { localDay } from '@flake/core/receivables';
import { currentSeason } from '@flake/core/time';
import { and, asc, bid, contract, customer, desc, eq, inArray, site, type Tx } from '@flake/db';
import { HttpError } from './http';

/**
 * Bids and renewals (issue 166). Decisions (Nov 19):
 * - Renewal reminders start each year on the company's date (August 1 unless changed), for next winter.
 * - A declined quote doesn't move a bid by itself: the bid shows it, and the office marks it lost. An accepted quote
 *   shows as ready to mark won.
 * - Residential, HOA and commercial bids share one list.
 * - A renewal is a new draft for next season copied from last season's accepted contract (services, salt price,
 *   terms). It is never sent or accepted by itself, and installments only start once it is accepted, as for any quote.
 */

export const nextSeasonOf = (season: string) => {
  const y = Number(season.slice(0, 4)) + 1;
  return `${y}-${String(y + 1).slice(2)}`;
};

/** Renewal reminders are on once the company's start date has passed in the summer before next season. */
export function renewalsOpen(today: string, renewalStart: string, season: string): boolean {
  const y = Number(season.slice(0, 4)) + 1;
  return today >= `${y}-${renewalStart}` || today >= `${y}-07-01`;
}

/**
 * This season's accepted contracts with nothing yet for next season: no draft, quote out, or acceptance. Lots
 * retired or customers archived are left out.
 */
export async function renewalQueue(tx: Tx, tz: string) {
  const season = currentSeason(new Date(), tz);
  const next = nextSeasonOf(season);
  const now = await tx.select({ k: contract, label: site.label, customer: customer.name, customer_id: customer.id }).from(contract)
    .innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id))
    .where(and(eq(contract.season, season), eq(contract.status, 'accepted'), eq(site.active, true))).orderBy(asc(customer.name), asc(site.label));
  const ahead = now.length ? await tx.select({ site_id: contract.site_id, status: contract.status }).from(contract).where(and(eq(contract.season, next), inArray(contract.site_id, now.map((r) => r.k.site_id)), inArray(contract.status, ['draft', 'sent', 'accepted']))) : [];
  const done = new Set(ahead.map((a) => a.site_id));
  return { season, next, rows: now.filter((r) => !done.has(r.k.site_id)).map((r) => ({ contract_id: r.k.id, site_id: r.k.site_id, label: r.label, customer: r.customer, customer_id: r.customer_id })) };
}

/** A draft for next season copied from an accepted contract. Refused when the lot already has one. */
export async function renewContract(tx: Tx, tenantId: string, contractId: string) {
  const [k] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!k) throw new HttpError(404, 'Contract not found');
  if (k.status !== 'accepted') throw new HttpError(409, 'Only an accepted contract can be renewed.', 'not_accepted');
  const next = nextSeasonOf(k.season);
  const [already] = await tx.select({ id: contract.id }).from(contract).where(and(eq(contract.site_id, k.site_id), eq(contract.season, next), inArray(contract.status, ['draft', 'sent', 'accepted'])));
  if (already) throw new HttpError(409, `This lot already has a ${next} contract.`, 'already_renewed');
  const [row] = await tx.insert(contract).values({ tenant_id: tenantId, site_id: k.site_id, season: next, status: 'draft', services: k.services, salt_pricing: k.salt_pricing, terms_md: k.terms_md }).returning();
  return row!;
}

export async function bidList(tx: Tx, tz: string) {
  const rows = await tx.select({ b: bid, customer: customer.name }).from(bid).leftJoin(customer, eq(customer.id, bid.customer_id)).orderBy(desc(bid.updated_at));
  const contractIds = rows.map((r) => r.b.contract_id).filter((x): x is string => Boolean(x));
  const ks = contractIds.length ? await tx.select({ id: contract.id, status: contract.status }).from(contract).where(inArray(contract.id, contractIds)) : [];
  const siteIds = [...new Set(rows.flatMap((r) => r.b.site_ids))];
  const labels = siteIds.length ? await tx.select({ id: site.id, label: site.label }).from(site).where(inArray(site.id, siteIds)) : [];
  return {
    today: localDay(new Date(), tz),
    rows: rows.map(({ b, customer: who }) => ({ ...b, who: who ?? b.prospect_name ?? '', sites: b.site_ids.map((id) => labels.find((l) => l.id === id)?.label ?? 'Lot'), quote: ks.find((k) => k.id === b.contract_id)?.status ?? null })),
  };
}
