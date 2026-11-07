import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { stormLive } from '@/lib/storms';

/** Polled every 3 seconds by the board. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  return stormLive({ userId: ctx.userId, tenantId: ctx.tenantId, timezone: ctx.tenant.timezone }, (await params).id);
});
