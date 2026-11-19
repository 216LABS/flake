import { claim, eq, inArray, proof_packet } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';

const body = z.object({
  status: z.enum(['open', 'pending', 'closed', 'denied']).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  adjuster: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /** Incident packets made for this claim (issue 163). */
  proof_packet_ids: z.array(z.uuid()).max(20).optional(),
});

/** Move a claim along, edit its details, or attach incident packets. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  return asUser(ctx, async (tx) => {
    if (b.proof_packet_ids?.length) {
      const found = await tx.select({ id: proof_packet.id }).from(proof_packet).where(inArray(proof_packet.id, b.proof_packet_ids));
      if (found.length !== new Set(b.proof_packet_ids).size) throw new HttpError(404, 'Proof packet not found');
    }
    const [row] = await tx.update(claim).set({ ...b, updated_at: new Date().toISOString() }).where(eq(claim.id, id)).returning();
    if (!row) throw new HttpError(404, 'Not found');
    return row;
  });
});
