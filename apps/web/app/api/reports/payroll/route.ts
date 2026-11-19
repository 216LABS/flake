import { adpCsv, gustoCsv } from '@flake/core/payroll';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { payrollFor, type PayrollSettings } from '@/lib/payroll';

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Payroll hours for one pay period as Gusto's or ADP's import file (issue 170). Owners and dispatchers only: it carries
 * pay. Employees only; subs are paid from Sub pay.
 */
export const GET = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const q = new URL(req.url).searchParams;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const format = q.get('format');
  if (!ymd.test(from) || !ymd.test(to) || from > to) throw new HttpError(422, 'Pick a pay period.');
  if (format !== 'gusto' && format !== 'adp') throw new HttpError(422, 'Pick Gusto or ADP.');
  const settings = (ctx.tenant.payroll ?? {}) as PayrollSettings;
  if (format === 'adp' && !settings.adp_co_code) throw new HttpError(422, 'Add your ADP company code under Payroll settings on Reports, Payroll first.', 'no_co_code');
  const rows = (await asUser(ctx, (tx) => payrollFor(tx, ctx.tenant.timezone, settings, from, to))).map((r) => ({ name: r.name, payrollId: r.payroll_id, regular: r.regular, storm: r.storm, holiday: r.holiday, ot: r.ot }));
  const body = format === 'gusto' ? gustoCsv(rows) : adpCsv(rows, { coCode: settings.adp_co_code!, batchId: to.replace(/-/g, '').slice(2) });
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-payroll-${format}-${from}-to-${to}.csv"` } });
});
