import { proCheckout } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { parseJson, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';

export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { interval } = await parseJson(req, proCheckout);
  const { payments } = await getProviders();
  const back = `${baseUrl()}/settings?tab=plan`;
  return payments.createProCheckout({ tenantId: ctx.tenantId, customerId: ctx.tenant.stripe_platform_customer_id, email: ctx.email, interval, successUrl: back, cancelUrl: back });
});
