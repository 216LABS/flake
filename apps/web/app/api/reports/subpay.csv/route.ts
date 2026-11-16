import { csvText } from '@flake/core/qbo';
import { asUser, requireApi } from '@/lib/auth';
import { tenantHasPro } from '@/lib/billing';
import { HttpError, route } from '@/lib/http';
import { period, subPayReport } from '@/lib/reports';

/** Sub pay for a period, one line per sub and storm plus the season flat rate and a total, for 1099 bookkeeping. */
export const GET = route(async (req) => {
  // Pay amounts are for owners and dispatchers (issue 160).
  const ctx = await requireApi('dispatcher');
  if (!tenantHasPro(ctx.tenant)) throw new HttpError(402, 'Sub pay statements are a Pro feature', 'pro_required');
  const q = new URL(req.url).searchParams;
  const p = period(q.get('from') ?? undefined, q.get('to') ?? undefined, ctx.tenant.timezone);
  if (p.backward) throw new HttpError(422, `The From date (${p.backward.from}) is after the To date (${p.backward.to}).`, 'backward_range');
  const rows = await asUser(ctx, (tx) => subPayReport(tx, p));
  const money = (c: number) => (c / 100).toFixed(2);
  const lines = ['Subcontractor,Storm,Visits,Amount'];
  for (const r of rows) {
    for (const s of r.storms) lines.push([csvText(r.name), csvText(s.name), String(s.visits), money(s.total_cents)].join(','));
    if (r.season_cents) lines.push([csvText(r.name), csvText('Season flat rate'), '', money(r.season_cents)].join(','));
    lines.push([csvText(r.name), csvText('Total'), String(r.visits), money(r.total_cents)].join(','));
  }
  return new Response(`${lines.join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-sub-pay-${p.from}-to-${p.to}.csv"` } });
});
