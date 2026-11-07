import { requireApi } from '@/lib/auth';
import { exportQbo, tenantHasPro } from '@/lib/billing';
import { HttpError, route } from '@/lib/http';

/** QuickBooks Online import format. A Pro feature, which the free first season includes. */
export const GET = route(async (req) => {
  const ctx = await requireApi('viewer');
  if (!tenantHasPro(ctx.tenant)) throw new HttpError(402, 'QuickBooks export is a Pro feature', 'pro_required');
  const stormId = new URL(req.url).searchParams.get('storm');
  if (!stormId) throw new HttpError(422, 'storm is required');
  const csv = await exportQbo({ userId: ctx.userId, tenantId: ctx.tenantId, timezone: ctx.tenant.timezone }, stormId);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-qbo-${stormId.slice(0, 8)}.csv"` } });
});
