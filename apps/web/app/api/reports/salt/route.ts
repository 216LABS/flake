import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { addStockEntry, removeStockEntry } from '@/lib/reports';

const entry = z.object({
  kind: z.enum(['delivery', 'count']),
  tons: z.number().min(0).max(100000),
  at: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(200).optional(),
});

/** A salt delivery adds to stock; a count says what is in the pile now. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, entry);
  if (body.kind === 'delivery' && body.tons <= 0) throw new HttpError(422, 'Tons delivered must be more than 0.');
  const at = body.at ?? new Date().toISOString();
  if (Date.parse(at) > Date.now() + 5 * 60_000) throw new HttpError(422, 'That date is in the future.');
  await addStockEntry(ctx.tenantId, { id: randomUUID(), kind: body.kind, tons: body.tons, at: new Date(at).toISOString(), ...(body.note ? { note: body.note } : {}) });
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(422, 'id is required');
  await removeStockEntry(ctx.tenantId, id);
  return { ok: true };
});
