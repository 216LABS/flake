import { and, crew_member, eq, serviceDb, tenant } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { HttpError, route } from '@/lib/http';
import { queueNotify, shortLink } from '@/lib/messaging';
import { hashToken, newToken } from '@/lib/tokens';

/** The token is only stored hashed, so a lost invite gets a new link. The old one stops working. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const token = newToken();
  const [row] = await asUser(ctx, (tx) => tx.update(crew_member).set({ invite_token_hash: hashToken(token) }).where(and(eq(crew_member.id, id), eq(crew_member.active, true))).returning());
  if (!row) throw new HttpError(404, 'Not found. Someone who left the crew has to be added again.');
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const link = await shortLink(ctx.tenantId, `/join/${token}`);
  await queueNotify(ctx.tenantId, { email: row.email }, { template: 'crew_invite', vars: { link }, subject: `${t!.name} invited you to get route links`, key: `crew_invite:${id}:${Date.now()}`, related: { crew_id: id } });
  return { invite_url: `${baseUrl()}/join/${token}` };
});
