import { requireApi } from '@/lib/auth';
import { exportQbo, tenantHasPro } from '@/lib/billing';
import { HttpError, route } from '@/lib/http';

/** QuickBooks Online import format. A Pro feature, which the free first season includes. */
export const GET = route(async (req) => {
  const ctx = await requireApi('viewer');
  if (!tenantHasPro(ctx.tenant)) throw new HttpError(402, 'QuickBooks export is a Pro feature', 'pro_required');
  const q = new URL(req.url).searchParams;
  const stormId = q.get('storm');
  const from = q.get('from');
  const to = q.get('to');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  // One storm, or every storm that started in a date range (issue 239).
  if (!stormId && !(from && to && day.test(from) && day.test(to))) throw new HttpError(422, 'Pick a storm, or a from and to date.');
  if (from && to && to < from) throw new HttpError(422, 'The to date is before the from date.');
  const csv = await exportQbo({ userId: ctx.userId, tenantId: ctx.tenantId, timezone: ctx.tenant.timezone }, stormId ?? { from: from!, to: to! });
  const name = stormId ? stormId.slice(0, 8) : `${from}-to-${to}`;
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-qbo-${name}.csv"` } });
});
