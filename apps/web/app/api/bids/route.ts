import { bid, customer, eq, inArray, site } from '@flake/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';

const body = z.object({
  customer_id: z.uuid().nullable().optional(),
  prospect_name: z.string().trim().max(200).optional(),
  prospect_contact: z.string().trim().max(300).optional(),
  site_ids: z.array(z.uuid()).max(50).default([]),
  season: z.string().regex(/^\d{4}-\d{2}$/),
  estimated_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
}).refine((b) => Boolean(b.customer_id) || Boolean(b.prospect_name), { message: 'Pick a customer or name the prospect.', path: ['prospect_name'] });

/** A new bid, from a lead (issue 166). */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  return asUser(ctx, async (tx) => {
    if (b.customer_id) {
      const [c] = await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, b.customer_id));
      if (!c) throw new HttpError(404, 'Customer not found');
    }
    if (b.site_ids.length) {
      const found = await tx.select({ id: site.id, customer_id: site.customer_id }).from(site).where(inArray(site.id, b.site_ids));
      if (found.length !== new Set(b.site_ids).size || found.some((s) => s.customer_id !== b.customer_id)) throw new HttpError(422, 'Those lots aren’t this customer’s.');
    }
    const [row] = await tx.insert(bid).values({ tenant_id: ctx.tenantId, customer_id: b.customer_id ?? null, prospect_name: b.prospect_name || null, prospect_contact: b.prospect_contact || null, site_ids: b.site_ids, season: b.season, estimated_cents: b.estimated_cents ?? null, notes: b.notes || null, created_by: ctx.userId }).returning();
    return NextResponse.json(row, { status: 201 });
  });
});
