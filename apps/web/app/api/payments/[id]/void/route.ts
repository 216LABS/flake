import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { voidPayment } from '@/lib/receivables';

const body = z.object({ reason: z.string().trim().min(1, 'Say why, like "entered twice".').max(300) });

/** A payment entered by mistake. The bill it paid is open again. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const { reason } = await parseJson(req, body);
  return asUser(ctx, (tx) => voidPayment(tx, ctx.tenantId, id, reason));
});
