import type { crewImportRow, customerImportRow } from '@flake/contracts';
import { and, crew_member, customer, eq, isNull, site, sql, tenant, withUser } from '@flake/db';
import type { z } from 'zod';
import { tidyAddress } from '@flake/core/address';
import { geocodeAddress } from './geocode';
import { checkCrewRow, checkImportRow, crewKey } from './csv';
import { HttpError } from './http';
import { queueMapNewLots, requireSiteRoom } from './sites';
import type { Ctx } from './storms';

type Row = z.infer<typeof customerImportRow>;
export { importBilling, importKind } from './csv';
export type ImportResult = { row: number; ok: true; customer: string; site: string; site_id: string; added_to_existing: boolean } | { row: number; ok: false; error: string };

/**
 * Adds each row as a customer and a lot, one at a time, so one bad row doesn't stop the rest. A row whose name matches
 * a current customer adds a lot to that customer, so a property manager's list makes one customer with many lots.
 * Nothing is sent to anyone.
 */
export async function importCustomers(ctx: Ctx, rows: Row[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  // A row with no billing column gets card on file only when the company can take cards; else Net-30 (issue 207).
  const [t] = await withUser(ctx.userId, (tx) => tx.select({ account: tenant.stripe_account_id, charges: tenant.stripe_charges_enabled }).from(tenant).where(eq(tenant.id, ctx.tenantId)));
  const cardsReady = Boolean(t?.account && t.charges);
  for (const [i, r] of rows.entries()) {
    try {
      const parsed = checkImportRow(r);
      if (!parsed.ok) throw new HttpError(422, parsed.problem);
      if (!cardsReady && !r.billing?.trim()) parsed.data.billing_mode = 'invoice_net30';
      const place = await geocodeAddress(r.address);
      // The geocoder's city, state and ZIP with the street, however the row was typed, so every lot in one city shares
      // one service area and the quote names the street, not the whole address (issue 206).
      const address = tidyAddress(r.address, place.label);
      const label = r.label?.trim() || address.split(',')[0]!.trim();
      const saved = await withUser(ctx.userId, async (tx) => {
        const [existing] = await tx.select({ id: customer.id, name: customer.name }).from(customer).where(and(sql`lower(${customer.name}) = lower(${parsed.data.name})`, isNull(customer.archived_at))).limit(1);
        await requireSiteRoom(tx, ctx.tenantId);
        const customerId = existing?.id ?? (await tx.insert(customer).values({ ...parsed.data, tenant_id: ctx.tenantId }).returning({ id: customer.id }))[0]!.id;
        const [lot] = await tx.insert(site).values({ tenant_id: ctx.tenantId, customer_id: customerId, label, address, lat: place.lat, lon: place.lon, branch_id: ctx.branchIds?.[0] ?? null }).returning({ id: site.id });
        return { customerId, siteId: lot!.id, name: existing?.name ?? parsed.data.name, existing: Boolean(existing) };
      });
      out.push({ row: i, ok: true, customer: saved.name, site: label, site_id: saved.siteId, added_to_existing: saved.existing });
    } catch (e) {
      out.push({ row: i, ok: false, error: e instanceof HttpError ? e.message : 'This row could not be saved. Try it again.' });
    }
  }
  // Their forecast areas right away, not at the next hourly weather run (issue 224).
  if (out.some((r) => r.ok)) await queueMapNewLots(ctx.tenantId);
  return out;
}

export type CrewImportResult = { row: number; ok: true; name: string } | { row: number; ok: false; error: string };

/**
 * Adds a crew list (issue 174). A row matching an active crew member, by mobile or by name when there is no mobile, is
 * left out rather than doubled. Nothing is sent and no one is opted in: the office still sends each join link.
 */
export async function importCrew(ctx: Ctx, rows: z.infer<typeof crewImportRow>[]): Promise<CrewImportResult[]> {
  return withUser(ctx.userId, async (tx) => {
    const have = new Set((await tx.select({ name: crew_member.name, phone: crew_member.phone_e164 }).from(crew_member).where(eq(crew_member.active, true)))
      .flatMap((c) => [crewKey(c.name, null), ...(c.phone ? [crewKey(c.name, c.phone)] : [])]));
    const out: CrewImportResult[] = [];
    for (const [i, r] of rows.entries()) {
      const parsed = checkCrewRow(r);
      if (!parsed.ok) { out.push({ row: i, ok: false, error: parsed.problem }); continue; }
      const key = crewKey(parsed.data.name, parsed.data.phone_e164);
      if (have.has(key)) { out.push({ row: i, ok: false, error: parsed.data.phone_e164 ? 'Someone on your crew already has this mobile.' : 'Someone on your crew already has this name.' }); continue; }
      await tx.insert(crew_member).values({ name: parsed.data.name, phone_e164: parsed.data.phone_e164 ?? null, kind: parsed.data.kind, language: parsed.data.language, tenant_id: ctx.tenantId, branch_id: ctx.branchIds?.[0] ?? null });
      have.add(key);
      have.add(crewKey(parsed.data.name, null));
      out.push({ row: i, ok: true, name: parsed.data.name });
    }
    return out;
  });
}
