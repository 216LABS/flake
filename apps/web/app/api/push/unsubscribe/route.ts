import { pushUnsubscribe } from '@flake/contracts';
import { eq, push_subscription } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';

export const POST = route(async (req) => {
  const ctx = await requireApi('viewer');
  const { endpoint } = await parseJson(req, pushUnsubscribe);
  await asUser(ctx, (tx) => tx.delete(push_subscription).where(eq(push_subscription.endpoint, endpoint)));
  return { ok: true };
});
