import { and, eq, salt_ledger, yard } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  reorder_tons: z.number().min(0).max(100000).nullable().optional(),
  active: z.boolean().optional(),
});

/** Rename, set the reorder point, or retire a yard. The last yard can't be retired. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, patch);
  return asUser(ctx, async (tx) => {
    if (b.active === false) {
      const live = await tx.select({ id: yard.id }).from(yard).where(eq(yard.active, true));
      if (live.length <= 1) throw new HttpError(409, 'This is your only yard. Add another before retiring it.', 'last_yard');
    }
    const [row] = await tx.update(yard).set(b).where(eq(yard.id, id)).returning();
    if (!row) throw new HttpError(404, 'Not found');
    return row;
  });
});

const entry = z.object({
  source: z.enum(['delivery', 'adjustment', 'count']),
  /** Delivery: tons in. Adjustment: tons in (+) or out (-), like a spill. Count: what's in the pile now. */
  tons: z.number().min(-100000).max(100000),
  cost_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  supplier: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  at: z.iso.datetime({ offset: true }).optional(),
});

/** A delivery from any supplier (with its cost), an adjustment, or a count, into this yard's ledger. */
export const POST = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, entry);
  if (b.source === 'delivery' && b.tons <= 0) throw new HttpError(422, 'Tons delivered must be more than 0.');
  if (b.source === 'count' && b.tons < 0) throw new HttpError(422, 'A count can’t be below 0.');
  if (b.source === 'adjustment' && b.tons === 0) throw new HttpError(422, 'An adjustment needs tons in or out.');
  if (b.source === 'adjustment' && !b.note) throw new HttpError(422, 'Say what the adjustment is for, like a spill.');
  const at = b.at ?? new Date().toISOString();
  if (Date.parse(at) > Date.now() + 5 * 60_000) throw new HttpError(422, 'That date is in the future.');
  return asUser(ctx, async (tx) => {
    const [y] = await tx.select({ id: yard.id }).from(yard).where(eq(yard.id, id));
    if (!y) throw new HttpError(404, 'Yard not found');
    const [row] = await tx.insert(salt_ledger).values({ tenant_id: ctx.tenantId, yard_id: id, qty_tons: b.tons, cost_cents: b.source === 'delivery' ? (b.cost_cents ?? null) : null, source: b.source, supplier: b.supplier || null, note: b.note || null, at: new Date(at).toISOString(), created_by: ctx.userId }).returning();
    return row;
  });
});

/** A ledger line entered by mistake. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  const line = new URL(req.url).searchParams.get('line') ?? '';
  if (!isUuid(id) || !isUuid(line)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const gone = await asUser(ctx, (tx) => tx.delete(salt_ledger).where(and(eq(salt_ledger.id, line), eq(salt_ledger.yard_id, id))).returning({ id: salt_ledger.id }));
  if (!gone.length) throw new HttpError(404, 'Not found');
  return { ok: true };
});
