import { requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { renewalPdf } from '@/lib/renewal-pdf';
import { renewalCsv, renewalPack } from '@/lib/renewal-pack';

/** The insurance renewal pack as PDF or CSV, for a date range (issue 236). */
export const GET = route(async (req) => {
  const ctx = await requireApi('viewer');
  const q = new URL(req.url).searchParams;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new HttpError(422, 'Pick a from and to date.');
  const pack = await renewalPack(ctx.tenantId, from, to);
  if (q.get('format') === 'csv') return new Response(renewalCsv(pack), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-renewal-pack-${from}-to-${to}.csv"` } });
  return new Response(new Uint8Array(await renewalPdf(pack, ctx.tenant.timezone)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="flake-renewal-pack-${from}-to-${to}.pdf"` } });
});
