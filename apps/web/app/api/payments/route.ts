import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { recordPayment } from '@/lib/receivables';

const body = z.object({
  kind: z.enum(['draft', 'installment']),
  id: z.uuid(),
  amount_cents: z.number().int().positive().max(1_000_000_000),
  method: z.enum(['check', 'ach', 'cash', 'card', 'other']),
  reference: z.string().trim().max(100).nullable().optional(),
  paid_on: z.iso.date(),
});

/** A check, ACH or cash payment the office took, against one bill (issue 168). */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const p = await parseJson(req, body);
  return asUser(ctx, (tx) => recordPayment(tx, ctx.tenantId, ctx.userId, { ...p, reference: p.reference || null }));
});
