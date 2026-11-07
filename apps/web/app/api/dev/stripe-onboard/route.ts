import { z } from 'zod';
import { eq, serviceDb, tenant } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { handleStripeEvent } from '@/lib/billing';
import { isProd } from '@/lib/env';
import { getProviders } from '@/lib/providers';
import { HttpError, parseJson, route } from '@/lib/http';

/** Mock Stripe: "charges_enabled after 1 click", or switching to Pro, through the same event handler. */
export const POST = route(async (req) => {
  if (isProd() || !(await getProviders()).payments.isMock) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('owner');
  const { pro, account } = await parseJson(req, z.object({ pro: z.boolean().optional(), account: z.string().optional() }));
  if (pro) {
    await handleStripeEvent({ id: `evt_mock_sub_${ctx.tenantId}_${Date.now()}`, type: 'customer.subscription.created', data: { object: { status: 'active', customer: `cus_mock_platform_${ctx.tenantId.slice(0, 8)}`, metadata: { tenant_id: ctx.tenantId } } } });
    return { ok: true };
  }
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const id = account ?? t!.stripe_account_id;
  if (id !== t!.stripe_account_id) throw new HttpError(403, 'Not your account');
  await handleStripeEvent({ id: `evt_mock_acct_${id}_${Date.now()}`, type: 'account.updated', account: id!, data: { object: { id, charges_enabled: true } } });
  return { ok: true };
});
