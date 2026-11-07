import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { removeMember } from '@/lib/team';

export const DELETE = route<{ params: Promise<{ userId: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('owner');
  await removeMember(ctx.tenantId, (await params).userId, ctx.userId);
  return { ok: true };
});
