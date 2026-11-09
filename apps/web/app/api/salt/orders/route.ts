import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { contractorSalt, placeOrder, saltOrderingReady } from '@/lib/salt-orders';

const order = z.object({
  tons: z.number().positive().max(500),
  address: z.string().trim().min(5).max(200),
  // A day of slack for time zones; a date already gone is a typo.
  needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => d >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), 'That date has already passed.').nullable().optional(),
  contact_name: z.string().trim().max(80).nullable().optional(),
  contact_phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  if (!(await saltOrderingReady())) throw new HttpError(404, 'Not found');
  return contractorSalt(ctx);
});

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  if (!(await saltOrderingReady())) throw new HttpError(404, 'Not found');
  return placeOrder(ctx, await parseJson(req, order));
});
