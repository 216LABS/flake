import type { customerImportRow } from '@flake/contracts';
import { and, customer, isNull, site, sql, withUser } from '@flake/db';
import type { z } from 'zod';
import { geocodeAddress } from './geocode';
import { checkImportRow } from './csv';
import { HttpError } from './http';
import { requireSiteRoom } from './sites';
import type { Ctx } from './storms';

type Row = z.infer<typeof customerImportRow>;
export { importBilling, importKind } from './csv';
export type ImportResult = { row: number; ok: true; customer: string; site: string; added_to_existing: boolean } | { row: number; ok: false; error: string };

/**
 * Adds each row as a customer and a lot, one at a time, so one bad row doesn't stop the rest. A row whose name matches
 * a current customer adds a lot to that customer, so a property manager's list makes one customer with many lots.
 * Nothing is sent to anyone.
 */
export async function importCustomers(ctx: Ctx, rows: Row[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const parsed = checkImportRow(r);
      if (!parsed.ok) throw new HttpError(422, parsed.problem);
      const place = await geocodeAddress(r.address);
      const label = r.label?.trim() || r.address.split(',')[0]!.trim();
      const saved = await withUser(ctx.userId, async (tx) => {
        const [existing] = await tx.select({ id: customer.id, name: customer.name }).from(customer).where(and(sql`lower(${customer.name}) = lower(${parsed.data.name})`, isNull(customer.archived_at))).limit(1);
        await requireSiteRoom(tx, ctx.tenantId);
        const customerId = existing?.id ?? (await tx.insert(customer).values({ ...parsed.data, tenant_id: ctx.tenantId }).returning({ id: customer.id }))[0]!.id;
        await tx.insert(site).values({ tenant_id: ctx.tenantId, customer_id: customerId, label, address: r.address, lat: place.lat, lon: place.lon });
        return { customerId, name: existing?.name ?? parsed.data.name, existing: Boolean(existing) };
      });
      out.push({ row: i, ok: true, customer: saved.name, site: label, added_to_existing: saved.existing });
    } catch (e) {
      out.push({ row: i, ok: false, error: e instanceof HttpError ? e.message : 'This row could not be saved. Try it again.' });
    }
  }
  return out;
}
