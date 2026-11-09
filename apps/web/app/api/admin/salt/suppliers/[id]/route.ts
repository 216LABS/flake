import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { isPlatformAdmin, saltOrderingReady, updateSupplier } from '@/lib/salt-orders';

const patch = z.object({
  price_per_ton_cents: z.number().int().positive().max(1_000_000).optional(),
  stop_fee_cents: z.number().int().min(0).max(1_000_000).optional(),
  referral_fee_per_ton_cents: z.number().int().min(0).max(100_000).optional(),
  radius_mi: z.number().positive().max(300).optional(),
  truckload_tons: z.number().positive().max(100).optional(),
  active: z.boolean().optional(),
  new_link: z.boolean().optional(),
});

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('viewer');
  const id = (await params).id;
  if (!isPlatformAdmin(ctx.email) || !isUuid(id) || !(await saltOrderingReady())) throw new HttpError(404, 'Not found');
  return updateSupplier(id, await parseJson(req, patch));
});
