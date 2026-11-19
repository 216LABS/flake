import { rateCardSchema } from '@flake/contracts';
import { eq, tenant } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { setSetting } from '@/lib/providers';

export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const rate_card = await parseJson(req, rateCardSchema);
  await asUser(ctx, (tx) => tx.update(tenant).set({ rate_card }).where(eq(tenant.id, ctx.tenantId)));
  // The setup checklist's "check your prices" step (issue 173): saved once, even unchanged, means checked.
  await setSetting(`setup.rate:${ctx.tenantId}`, { at: new Date().toISOString() });
  return { ok: true };
});
