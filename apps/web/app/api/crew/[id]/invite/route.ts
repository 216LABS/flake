import { and, crew_member, eq } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { HttpError, route } from '@/lib/http';
import { hashToken, newInviteToken } from '@/lib/tokens';

/**
 * The token is only stored hashed, so a lost invite gets a new link. The old one stops working. A new link is a new
 * invite: the driver joins again with it, which is how they fix their own number after joining (issue 133). The office sends it from its own phone (D16).
 */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const token = newInviteToken();
  const [row] = await asUser(ctx, (tx) => tx.update(crew_member).set({ invite_token_hash: hashToken(token), joined_at: null }).where(and(eq(crew_member.id, id), eq(crew_member.active, true))).returning());
  if (!row) throw new HttpError(404, 'Not found. Someone who left the crew has to be added again.');
  return { invite_url: `${baseUrl()}/join/${token}` };
});
