import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createShare, listShares } from '@/lib/share-links';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({ kind: z.enum(['proof', 'renewal']), proof_packet_id: z.uuid().optional(), from: day.optional(), to: day.optional(), days: z.number().int().min(1).max(90).default(30), label: z.string().trim().max(200).optional() });

/** Share links for agents, adjusters and attorneys (issue 236). Viewers can see the list; they can't make links. */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { links: await asUser(ctx, (tx) => listShares(tx)) };
});

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  return asUser(ctx, (tx) => createShare(tx, ctx.tenantId, ctx.userId, b));
});
