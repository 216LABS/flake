import { yard } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { geocodeAddress } from '@/lib/geocode';
import { parseJson, route } from '@/lib/http';
import { yardStock } from '@/lib/yards';

/** Every yard with its salt on hand, cost per ton and recent ledger (issue 169). */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { yards: await yardStock(ctx.tenantId) };
});

const body = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  reorder_tons: z.number().min(0).max(100000).nullable().optional(),
});

/** A second pile in another town, say. Its address is found on the map once. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  const point = b.address ? await geocodeAddress(b.address).catch(() => null) : null;
  const [row] = await asUser(ctx, (tx) => tx.insert(yard).values({ tenant_id: ctx.tenantId, name: b.name, address: b.address || null, lat: point?.lat ?? null, lon: point?.lon ?? null, reorder_tons: b.reorder_tons ?? null, branch_id: ctx.branchIds?.[0] ?? null }).returning());
  return row;
});
