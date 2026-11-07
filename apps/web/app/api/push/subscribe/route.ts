import { pushSubscribe } from '@flake/contracts';
import { push_subscription, serviceDb } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/** A browser's endpoint belongs to whoever signed in on it last, so a shared phone moves to the new person. */
export const POST = route(async (req) => {
  const ctx = await requireApi('viewer');
  if (!(await getProviders()).push.publicKey) throw new HttpError(503, 'Push is not set up on this deployment.', 'not_configured');
  const { endpoint, keys } = await parseJson(req, pushSubscribe);
  const values = { tenant_id: ctx.tenantId, user_id: ctx.userId, p256dh: keys.p256dh, auth: keys.auth };
  await serviceDb().insert(push_subscription).values({ endpoint, ...values }).onConflictDoUpdate({ target: push_subscription.endpoint, set: values });
  return { ok: true };
});
