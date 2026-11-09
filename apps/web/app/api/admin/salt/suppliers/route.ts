import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { adminOverview, createSupplier, isPlatformAdmin, saltOrderingReady } from '@/lib/salt-orders';

async function admin() {
  const ctx = await requireApi('viewer');
  if (!isPlatformAdmin(ctx.email) || !(await saltOrderingReady())) throw new HttpError(404, 'Not found');
  return ctx;
}

const supplier = z.object({
  name: z.string().trim().min(2).max(120),
  contact_name: z.string().trim().max(80).nullable().optional(),
  email: z.email().max(254),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().min(5).max(200),
  radius_mi: z.number().positive().max(300),
  price_per_ton_cents: z.number().int().positive().max(1_000_000),
  truckload_tons: z.number().positive().max(100),
  stop_fee_cents: z.number().int().min(0).max(1_000_000),
  referral_fee_per_ton_cents: z.number().int().min(0).max(100_000),
});

export const GET = route(async () => {
  await admin();
  return adminOverview();
});

export const POST = route(async (req) => {
  await admin();
  return createSupplier(await parseJson(req, supplier));
});
