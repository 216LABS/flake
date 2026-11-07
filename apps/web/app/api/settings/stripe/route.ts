import { eq, serviceDb, tenant } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

/** Stripe-hosted onboarding. The account pays Stripe fees and uses its own Dashboard. */
export const POST = route(async () => {
  const ctx = await requireApi('owner');
  const { payments } = await getProviders();
  let accountId = ctx.tenant.stripe_account_id;
  if (!accountId) {
    accountId = (await payments.createConnectedAccount({ email: ctx.email, businessName: ctx.tenant.name, tenantId: ctx.tenantId })).accountId;
    await serviceDb().update(tenant).set({ stripe_account_id: accountId }).where(eq(tenant.id, ctx.tenantId));
  }
  const back = `${baseUrl()}/settings?tab=payments`;
  return payments.createAccountLink(accountId, back, back);
});
