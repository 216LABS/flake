import { csvText } from '@flake/core/qbo';
import { sql } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';

const EXPORT_TABLES = ['customer', 'site', 'contract', 'crew_member', 'route', 'storm', 'storm_run', 'run_stop', 'visit', 'visit_photo', 'visit_correction', 'problem_report', 'invoice_draft', 'message_log', 'proof_packet'];

/** CSV of one table for this tenant. RLS scopes it, and the link token columns never leave the server. */
export const GET = route(async (req) => {
  const ctx = await requireApi('owner');
  const table = new URL(req.url).searchParams.get('table') ?? '';
  if (!EXPORT_TABLES.includes(table)) throw new HttpError(422, 'Unknown table');
  const rows = (await asUser(ctx, (tx) => tx.execute(sql`select * from ${sql.identifier(table)}`))) as unknown as Record<string, unknown>[];
  const hidden = new Set(['link_token_hash', 'link_token_enc', 'quote_token_hash', 'invite_token_hash', 'manifest']);
  const cols = Object.keys(rows[0] ?? {}).filter((c) => !hidden.has(c));
  const cell = (v: unknown) => (v === null || v === undefined ? '' : csvText(typeof v === 'object' ? JSON.stringify(v) : String(v)));
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-${table}.csv"` } });
});
