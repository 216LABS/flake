import { requireApi } from '@/lib/auth';
import { HttpError, rateLimit, route } from '@/lib/http';
import { queuePush } from '@/lib/messaging';
import { getProviders } from '@/lib/providers';

export const POST = route(async () => {
  const ctx = await requireApi('viewer');
  rateLimit(`pushtest:${ctx.userId}`, 5, 60000);
  if (!(await getProviders()).push.publicKey) throw new HttpError(503, 'Push is not set up on this deployment.', 'not_configured');
  await queuePush(ctx.tenantId, { title: 'Flake test alert', body: 'Alerts are working on this device.', url: '/settings?tab=alerts', key: `test:${ctx.userId}:${Date.now()}`, userId: ctx.userId });
  return { ok: true };
});
