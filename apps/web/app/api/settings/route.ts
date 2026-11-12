import { tenantSettings, tollFreeSubmit } from '@flake/contracts';
import { eq, tenant } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { requestTollFree } from '@/lib/sms-admin';
import { geocodeAddress } from '@/lib/geocode';

export const PATCH = route(async (req) => {
  const ctx = await requireApi('owner');
  const { ein, website, contact_name, expected_monthly_volume, yard_address, yard_point, ...rest } = await parseJson(req, tenantSettings);
  // The yard is found on the map once, when it's saved, so planning never waits on a lookup (issue 64). A suggestion the
  // owner picked already has its point (issue 79).
  const yard = yard_address === undefined ? undefined
    : !yard_address ? null
    : yard_point ? { address: yard_address, lat: yard_point.lat, lon: yard_point.lon }
    : await geocodeAddress(yard_address).then((g) => ({ address: yard_address, lat: g.lat, lon: g.lon }));
  const verification = { ...((ctx.tenant.sms_verification ?? {}) as Record<string, unknown>), ...(website !== undefined ? { website } : {}), ...(contact_name !== undefined ? { contact_name } : {}), ...(expected_monthly_volume !== undefined ? { expected_monthly_volume } : {}) };
  const [row] = await asUser(ctx, (tx) => tx.update(tenant).set({ ...rest, ...(yard !== undefined ? { yard } : {}), sms_verification: verification, ...(ein ? { ein_last4: ein.replace(/\D/g, '').slice(-4) } : {}) }).where(eq(tenant.id, ctx.tenantId)).returning());
  return row;
});

/** Submit or resubmit toll-free verification. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { ein } = await parseJson(req, tollFreeSubmit);
  await requestTollFree(ctx.tenantId, ein);
  return { status: 'pending' };
});
