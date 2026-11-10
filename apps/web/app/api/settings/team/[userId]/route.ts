import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { changeRole, removeMember, resendInvite } from '@/lib/team';

type P = { params: Promise<{ userId: string }> };

export const DELETE = route<P>(async (_req, { params }) => {
  const ctx = await requireApi('owner');
  await removeMember(ctx.tenantId, (await params).userId, ctx.userId);
  return { ok: true };
});

/** Changes someone's role. */
export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await requireApi('owner');
  const { role } = await parseJson(req, z.object({ role: z.enum(['owner', 'dispatcher', 'viewer']) }));
  return changeRole(ctx.tenantId, (await params).userId, role, ctx.userId);
});

/** Sends the invite email again. */
export const POST = route<P>(async (_req, { params }) => {
  const ctx = await requireApi('owner');
  return resendInvite(ctx.tenantId, (await params).userId);
});
