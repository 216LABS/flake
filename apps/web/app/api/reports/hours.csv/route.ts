import { hoursCsv } from '@flake/core/reports';
import { asUser, requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { crewHours, period } from '@/lib/reports';

/** Crew shifts for a pay period, in columns a payroll service imports. */
export const GET = route(async (req) => {
  const ctx = await requireApi('viewer');
  const q = new URL(req.url).searchParams;
  const p = period(q.get('from') ?? undefined, q.get('to') ?? undefined, ctx.tenant.timezone);
  const rows = await asUser(ctx, (tx) => crewHours(tx, p, ctx.tenant.timezone));
  return new Response(hoursCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-hours-${p.from}-to-${p.to}.csv"` } });
});
