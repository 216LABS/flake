import { tenantSettings, tollFreeSubmit } from '@flake/contracts';
import { eq, tenant } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { requestTollFree } from '@/lib/sms-admin';

export const PATCH = route(async (req) => {
  const ctx = await requireApi('owner');
  const { ein, website, contact_name, expected_monthly_volume, ...rest } = await parseJson(req, tenantSettings);
  const verification = { ...((ctx.tenant.sms_verification ?? {}) as Record<string, unknown>), ...(website !== undefined ? { website } : {}), ...(contact_name !== undefined ? { contact_name } : {}), ...(expected_monthly_volume !== undefined ? { expected_monthly_volume } : {}) };
  const [row] = await asUser(ctx, (tx) => tx.update(tenant).set({ ...rest, sms_verification: verification, ...(ein ? { ein_last4: ein.replace(/\D/g, '').slice(-4) } : {}) }).where(eq(tenant.id, ctx.tenantId)).returning());
  return row;
});

/** Submit or resubmit toll-free verification. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { ein } = await parseJson(req, tollFreeSubmit);
  await requestTollFree(ctx.tenantId, ein);
  return { status: 'pending' };
});
