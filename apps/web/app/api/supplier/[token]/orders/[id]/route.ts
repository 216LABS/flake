import { z } from 'zod';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { resolveSupplier, supplierUpdate } from '@/lib/salt-orders';

const change = z.union([
  z.object({ delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ delivered_tons: z.number().positive().max(500) }),
]);

/** The supplier's private link sets a delivery date or marks a load delivered. No login. */
export const POST = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  rateLimit(`supplier:${clientIp(req) ?? 'unknown'}`, 120, 60_000);
  const { token, id } = await params;
  const s = await resolveSupplier(token);
  if (!s) throw new HttpError(404, 'This link is no longer active.');
  return supplierUpdate(s, id, await parseJson(req, change));
});
