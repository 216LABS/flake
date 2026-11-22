import { asUser, requireApi } from '@/lib/auth';
import { tenantHasPro } from '@/lib/billing';
import { HttpError, isUuid, route } from '@/lib/http';
import { period } from '@/lib/reports';
import { subStatement } from '@/lib/subs';

/** One sub company's statement for a period, and whether the sub said it looks right or disputed a line. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  if (!tenantHasPro(ctx.tenant)) throw new HttpError(402, 'Sub pay statements are a Pro feature', 'pro_required');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Sub company not found');
  const q = new URL(req.url).searchParams;
  const p = period(q.get('from') ?? undefined, q.get('to') ?? undefined, ctx.tenant.timezone);
  if (p.backward) throw new HttpError(422, `The From date (${p.backward.from}) is after the To date (${p.backward.to}).`, 'backward_range');
  return asUser(ctx, (tx) => subStatement(tx, ctx.tenantId, id, p));
});
