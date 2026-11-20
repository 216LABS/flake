import { csvText } from '@flake/core/qbo';
import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { saltPlan } from '@/lib/salt-plan';

/** Salt used per lot this season, for a spreadsheet (issue 197). */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  const plan = await saltPlan(ctx.tenantId);
  const head = ['Lot', 'Sq ft', 'Storms', 'Salted visits', 'Tons used', 'Tons per salting', 'Per salting from', 'Tons per 1000 sq ft'];
  const rows = plan.lots.map((l) => [l.label, l.sqft ?? '', l.storms, l.visits, l.tons, l.per_event ?? '', l.per_event_from ?? '', l.per_1000_sqft ?? ''].map((v) => csvText(String(v))).join(','));
  return new Response([head.join(','), ...rows].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-salt-${plan.season}.csv"` } });
});
