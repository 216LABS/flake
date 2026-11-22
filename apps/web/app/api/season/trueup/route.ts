import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { decideTrueUp, draftTrueUp } from '@/lib/season-terms';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft'), contract_id: z.uuid() }),
  z.object({ action: z.literal('approve'), id: z.uuid() }),
  z.object({ action: z.literal('discard'), id: z.uuid() }),
]);

/** A seasonal minimum's true-up (issue 233): drafted for review, then approved as a bill or discarded. Never sent by itself. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const b = await parseJson(req, body);
  if (b.action === 'draft') return asUser(ctx, (tx) => draftTrueUp(tx, ctx.tenantId, ctx.tenant.timezone, b.contract_id));
  return asUser(ctx, (tx) => decideTrueUp(tx, ctx.tenantId, b.id, b.action === 'approve'));
});
