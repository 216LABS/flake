import { and, bid, contract, eq, inArray } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  stage: z.enum(['lead', 'site_walk', 'quote_sent', 'won', 'lost']).optional(),
  estimated_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  lost_reason: z.string().trim().max(500).nullable().optional(),
});

/**
 * Move a bid along. Moving to "quote sent" links the lot's quote for that season when there is one; "won" needs that
 * quote accepted; "lost" asks why.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  return asUser(ctx, async (tx) => {
    const [now] = await tx.select().from(bid).where(eq(bid.id, id));
    if (!now) throw new HttpError(404, 'Not found');
    let contractId = now.contract_id;
    if ((b.stage === 'quote_sent' || b.stage === 'won') && !contractId && now.site_ids.length) {
      const [k] = await tx.select({ id: contract.id }).from(contract).where(and(inArray(contract.site_id, now.site_ids), eq(contract.season, now.season), inArray(contract.status, ['draft', 'sent', 'accepted'])));
      contractId = k?.id ?? null;
    }
    if (b.stage === 'won') {
      const [k] = contractId ? await tx.select({ status: contract.status }).from(contract).where(eq(contract.id, contractId)) : [];
      if (k?.status !== 'accepted') throw new HttpError(409, 'Won means the quote is accepted. Send the quote from the lot and mark it won once they sign.', 'not_accepted');
    }
    if (b.stage === 'lost' && !(b.lost_reason ?? now.lost_reason)) throw new HttpError(422, 'Say why it was lost, like price or went with another plow company.');
    const [row] = await tx.update(bid).set({ ...b, contract_id: contractId, updated_at: new Date().toISOString() }).where(eq(bid.id, id)).returning();
    return row;
  });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const gone = await asUser(ctx, (tx) => tx.delete(bid).where(eq(bid.id, id)).returning({ id: bid.id }));
  if (!gone.length) throw new HttpError(404, 'Not found');
  return { ok: true };
});

