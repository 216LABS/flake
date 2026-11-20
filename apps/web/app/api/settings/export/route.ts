import { csvText } from '@flake/core/qbo';
import { sql } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, route } from '@/lib/http';
import { zip } from '@/lib/zip';

const EXPORT_TABLES = ['customer', 'site', 'contract', 'crew_member', 'route', 'storm', 'storm_run', 'run_stop', 'visit', 'visit_photo', 'visit_correction', 'problem_report', 'invoice_draft', 'message_log', 'proof_packet', 'truck', 'equipment_log', 'site_walk_item'];

const HIDDEN = new Set(['link_token_hash', 'link_token_enc', 'quote_token_hash', 'invite_token_hash', 'manifest']);

async function tableCsv(ctx: Awaited<ReturnType<typeof requireApi>>, table: string): Promise<string> {
  const rows = (await asUser(ctx, (tx) => tx.execute(sql`select * from ${sql.identifier(table)}`))) as unknown as Record<string, unknown>[];
  const cols = Object.keys(rows[0] ?? {}).filter((c) => !HIDDEN.has(c));
  const cell = (v: unknown) => (v === null || v === undefined ? '' : csvText(typeof v === 'object' ? JSON.stringify(v) : String(v)));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/**
 * CSV of one table for this tenant, or table=all for every table in one .zip (issue 200). RLS scopes it, and the link
 * token columns never leave the server.
 */
export const GET = route(async (req) => {
  const ctx = await requireApi('owner');
  const table = new URL(req.url).searchParams.get('table') ?? '';
  if (table === 'all') {
    const files = [];
    for (const t of EXPORT_TABLES) files.push({ name: `flake-${t}.csv`, data: await tableCsv(ctx, t) });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(zip(files)), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="flake-export-${day}.zip"` } });
  }
  if (!EXPORT_TABLES.includes(table)) throw new HttpError(422, 'Unknown table');
  return new Response(await tableCsv(ctx, table), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="flake-${table}.csv"` } });
});
