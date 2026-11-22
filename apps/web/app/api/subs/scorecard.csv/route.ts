import { currentSeason } from '@flake/core/time';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { period } from '@/lib/reports';
import { scorecardCsv, scorecards } from '@/lib/subs';

/** The season scorecard per sub company as a spreadsheet. Defaults to this winter, July 1 to today. */
export const GET = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const q = new URL(req.url).searchParams;
  const tz = ctx.tenant.timezone;
  const start = `${currentSeason(new Date(), tz).slice(0, 4)}-07-01`;
  const p = period(q.get('from') ?? start, q.get('to') ?? undefined, tz);
  if (p.backward) throw new HttpError(422, `The From date (${p.backward.from}) is after the To date (${p.backward.to}).`, 'backward_range');
  const rows = await asUser(ctx, (tx) => scorecards(tx, p, tz));
  return new Response(scorecardCsv(rows, p), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-sub-scorecard-${p.from}-to-${p.to}.csv"` } });
});
