import { customerCreate, type customerImportRow } from '@flake/contracts';
import { and, customer, isNull, site, sql, withUser } from '@flake/db';
import type { z } from 'zod';
import { geocodeAddress } from './geocode';
import { HttpError, readableIssue } from './http';
import { requireSiteRoom } from './sites';
import type { Ctx } from './storms';

type Row = z.infer<typeof customerImportRow>;
export type ImportResult = { row: number; ok: true; customer: string; site: string; added_to_existing: boolean } | { row: number; ok: false; error: string };

/** The words people use in a spreadsheet, to Flake's customer kinds. Blank means residential. */
export function importKind(v: string | null | undefined): 'residential' | 'commercial' | 'hoa' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /^(res|residential|home|house|driveway)/.test(s)) return 'residential';
  if (/^(com|commercial|business|lot|retail|office)/.test(s)) return 'commercial';
  if (/^(hoa|association|condo)/.test(s)) return 'hoa';
  return null;
}

/** The same for billing. Blank uses the default, card on file. */
export function importBilling(v: string | null | undefined): 'card_on_file' | 'ach_on_file' | 'invoice_net30' | 'manual' | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s || /card/.test(s)) return 'card_on_file';
  if (/bank|ach/.test(s)) return 'ach_on_file';
  if (/invoice|net/.test(s)) return 'invoice_net30';
  if (/manual|check|cash|bill/.test(s)) return 'manual';
  return null;
}

/**
 * Adds each row as a customer and a lot, one at a time, so one bad row doesn't stop the rest. A row whose name matches
 * a current customer adds a lot to that customer, so a property manager's list makes one customer with many lots.
 * Nothing is sent to anyone.
 */
export async function importCustomers(ctx: Ctx, rows: Row[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const kind = importKind(r.kind);
      if (!kind) throw new HttpError(422, `Kind "${r.kind}" isn't one of residential, commercial or HOA.`);
      const billing = importBilling(r.billing);
      if (!billing) throw new HttpError(422, `Billing "${r.billing}" isn't one of card, bank, invoice or manual.`);
      const parsed = customerCreate.safeParse({ name: r.name, kind, billing_mode: billing, email: r.email ?? '', phone_e164: r.phone ?? '' });
      if (!parsed.success) throw new HttpError(422, [...new Set(parsed.error.issues.map(readableIssue))].join(' '));
      const place = await geocodeAddress(r.address);
      const label = r.label?.trim() || r.address.split(',')[0]!.trim();
      const saved = await withUser(ctx.userId, async (tx) => {
        const [existing] = await tx.select({ id: customer.id }).from(customer).where(and(sql`lower(${customer.name}) = lower(${parsed.data.name})`, isNull(customer.archived_at))).limit(1);
        await requireSiteRoom(tx, ctx.tenantId);
        const customerId = existing?.id ?? (await tx.insert(customer).values({ ...parsed.data, tenant_id: ctx.tenantId }).returning({ id: customer.id }))[0]!.id;
        await tx.insert(site).values({ tenant_id: ctx.tenantId, customer_id: customerId, label, address: r.address, lat: place.lat, lon: place.lon });
        return { customerId, existing: Boolean(existing) };
      });
      out.push({ row: i, ok: true, customer: parsed.data.name, site: label, added_to_existing: saved.existing });
    } catch (e) {
      out.push({ row: i, ok: false, error: e instanceof HttpError ? e.message : 'This row could not be saved. Try it again.' });
    }
  }
  return out;
}
