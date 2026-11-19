import { claim, eq, site } from '@flake/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';

const body = z.object({
  site_id: z.uuid(),
  incident_at: z.iso.datetime({ offset: true }),
  reference: z.string().trim().max(100).optional(),
  adjuster: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
});

/** A claim on a lot: a slip and fall, a damaged curb (issue 165). Nothing about it is sent anywhere. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  if (Date.parse(b.incident_at) > Date.now() + 60_000) throw new HttpError(422, 'The incident time is in the future.');
  return asUser(ctx, async (tx) => {
    const [s] = await tx.select({ id: site.id }).from(site).where(eq(site.id, b.site_id));
    if (!s) throw new HttpError(404, 'Lot not found');
    const [row] = await tx.insert(claim).values({ tenant_id: ctx.tenantId, site_id: b.site_id, incident_at: new Date(b.incident_at).toISOString(), reference: b.reference || null, adjuster: b.adjuster || null, notes: b.notes || null, created_by: ctx.userId }).returning();
    return NextResponse.json(row, { status: 201 });
  });
});
