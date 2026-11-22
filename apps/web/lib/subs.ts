import { subCoverage } from '@flake/core/compliance';
import { localDay } from '@flake/core/receivables';
import { isLate } from '@flake/core/time';
import { and, asc, certificate, crew_member, eq, inArray, isNull, serviceDb, site, sql, sub_company, sub_statement, tenant, type Tx } from '@flake/db';
import { baseUrl } from './env';
import { HttpError } from './http';
import { type Period, subPayReport } from './reports';
import { decryptToken, encryptToken, hashToken, newToken } from './tokens';

/**
 * Subcontractor companies (issue 226): a sub outfit with several drivers. Its drivers' pay rolls up to one statement,
 * it gets a private portal link (runs, visits, photos and pay, never customers' contacts, prices or other crews), a
 * block of lots can be given to it, and a season scorecard. Extends #160 (sub pay) and #165 (certificates).
 */
export type SubCompany = typeof sub_company.$inferSelect;

export const subPortalUrl = (token: string) => `${baseUrl()}/sub/${token}`;

export async function listSubCompanies(tx: Tx) {
  const subs = await tx.select().from(sub_company).where(isNull(sub_company.archived_at)).orderBy(asc(sub_company.name));
  const drivers = subs.length ? await tx.select({ id: crew_member.id, name: crew_member.name, sub_company_id: crew_member.sub_company_id, active: crew_member.active }).from(crew_member).where(inArray(crew_member.sub_company_id, subs.map((s) => s.id))).orderBy(asc(crew_member.name)) : [];
  const lots = subs.length ? await tx.select({ id: site.sub_company_id, n: sql<number>`count(*)::int` }).from(site).where(and(inArray(site.sub_company_id, subs.map((s) => s.id)), eq(site.active, true))).groupBy(site.sub_company_id) : [];
  return subs.map((s) => ({
    id: s.id, name: s.name, contact_name: s.contact_name, phone_e164: s.phone_e164, email: s.email,
    portal_url: s.portal_token_enc ? subPortalUrl(decryptToken(s.portal_token_enc)) : null,
    drivers: drivers.filter((d) => d.sub_company_id === s.id && d.active),
    lots: lots.find((l) => l.id === s.id)?.n ?? 0,
  }));
}

export async function createSubCompany(tx: Tx, tenantId: string, b: { name: string; contact_name?: string | null; phone_e164?: string | null; email?: string | null }) {
  const [row] = await tx.insert(sub_company).values({ tenant_id: tenantId, name: b.name.trim(), contact_name: b.contact_name?.trim() || null, phone_e164: b.phone_e164 || null, email: b.email?.trim() || null }).returning();
  return row!;
}

export async function updateSubCompany(tx: Tx, id: string, b: { name?: string; contact_name?: string | null; phone_e164?: string | null; email?: string | null; archived?: boolean }) {
  const set: Partial<typeof sub_company.$inferInsert> = {};
  if (b.name !== undefined) set.name = b.name.trim();
  if (b.contact_name !== undefined) set.contact_name = b.contact_name?.trim() || null;
  if (b.phone_e164 !== undefined) set.phone_e164 = b.phone_e164 || null;
  if (b.email !== undefined) set.email = b.email?.trim() || null;
  if (b.archived !== undefined) set.archived_at = b.archived ? new Date().toISOString() : null;
  const [row] = await tx.update(sub_company).set(set).where(eq(sub_company.id, id)).returning();
  if (!row) throw new HttpError(404, 'Sub company not found');
  // An archived sub's lots go back to the company's own routes, and its portal stops working.
  if (b.archived) {
    await tx.update(site).set({ sub_company_id: null }).where(eq(site.sub_company_id, id));
    await tx.update(sub_company).set({ portal_token_hash: null, portal_token_enc: null }).where(eq(sub_company.id, id));
  }
  return row;
}

/** Which sub company a driver works for, or none. A driver in a sub company is paid as a sub. */
export async function setDriverCompany(tx: Tx, crewId: string, subCompanyId: string | null) {
  if (subCompanyId) {
    const [s] = await tx.select({ id: sub_company.id }).from(sub_company).where(and(eq(sub_company.id, subCompanyId), isNull(sub_company.archived_at)));
    if (!s) throw new HttpError(404, 'Sub company not found');
  }
  const [row] = await tx.update(crew_member).set(subCompanyId ? { sub_company_id: subCompanyId, kind: 'sub' } : { sub_company_id: null }).where(eq(crew_member.id, crewId)).returning({ id: crew_member.id });
  if (!row) throw new HttpError(404, 'Driver not found');
  return { ok: true };
}

/** Gives a block of lots to a sub company (or takes them back with null). Start storm puts them on that sub's run. */
export async function assignSites(tx: Tx, siteIds: string[], subCompanyId: string | null) {
  if (!siteIds.length) return { updated: 0 };
  if (subCompanyId) {
    const [s] = await tx.select({ id: sub_company.id }).from(sub_company).where(and(eq(sub_company.id, subCompanyId), isNull(sub_company.archived_at)));
    if (!s) throw new HttpError(404, 'Sub company not found');
  }
  const rows = await tx.update(site).set({ sub_company_id: subCompanyId }).where(inArray(site.id, siteIds)).returning({ id: site.id });
  return { updated: rows.length };
}

/** A new portal link for the sub. Making one turns the old one off. */
export async function resetSubPortal(tx: Tx, id: string) {
  const token = newToken();
  const [row] = await tx.update(sub_company).set({ portal_token_hash: hashToken(token), portal_token_enc: encryptToken(token) }).where(and(eq(sub_company.id, id), isNull(sub_company.archived_at))).returning({ id: sub_company.id });
  if (!row) throw new HttpError(404, 'Sub company not found');
  return { url: subPortalUrl(token) };
}

export async function resolveSubPortal(token: string): Promise<{ sub: SubCompany; company: string; timezone: string; tenant: typeof tenant.$inferSelect } | null> {
  if (!token || token.length > 100) return null;
  const [r] = await serviceDb().select({ sub: sub_company, company: tenant.name, timezone: tenant.timezone, tenant }).from(sub_company).innerJoin(tenant, eq(tenant.id, sub_company.tenant_id))
    .where(and(eq(sub_company.portal_token_hash, hashToken(token)), isNull(sub_company.archived_at)));
  return r ?? null;
}

export interface SubStatementLine { crew_id: string; driver: string; storm_id: string; storm: string; visits: number; amount_cents: number }
export interface SubStatement {
  from: string; to: string;
  lines: SubStatementLine[];
  season: { driver: string; amount_cents: number }[];
  drivers: { crew_id: string; driver: string; visits: number; total_cents: number }[];
  total_cents: number; visits: number;
  answer: { status: 'acknowledged' | 'disputed'; note: string | null; disputed_line: string | null; responded_at: string } | null;
}

/**
 * One statement per sub company for a period: every driver's storms priced like the storm's pay page (#160), plus any
 * season flat rate. The total is the sum of the per-driver totals, which are the sums of their lines.
 */
export function rollUp(rows: Awaited<ReturnType<typeof subPayReport>>, p: Pick<Period, 'from' | 'to'>): Omit<SubStatement, 'answer'> {
  const lines: SubStatementLine[] = rows.flatMap((r) => r.storms.map((s) => ({ crew_id: r.crew_id, driver: r.name, storm_id: s.id, storm: s.name, visits: s.visits, amount_cents: s.total_cents })));
  const season = rows.filter((r) => r.season_cents).map((r) => ({ driver: r.name, amount_cents: r.season_cents }));
  const drivers = rows.map((r) => ({ crew_id: r.crew_id, driver: r.name, visits: r.visits, total_cents: r.total_cents }));
  return { from: p.from, to: p.to, lines, season, drivers, total_cents: drivers.reduce((n, d) => n + d.total_cents, 0), visits: drivers.reduce((n, d) => n + d.visits, 0) };
}

/** The office's view (RLS applies) or the portal's (server connection, scoped to the sub). */
export async function subStatement(tx: Tx, tenantId: string, subCompanyId: string, p: Period, portal = false): Promise<SubStatement> {
  const rows = (await subPayReport(tx, p, portal ? { tenantId, subCompanyId } : undefined)).filter((r) => r.sub_company_id === subCompanyId);
  const [answer] = await tx.select().from(sub_statement).where(and(eq(sub_statement.tenant_id, tenantId), eq(sub_statement.sub_company_id, subCompanyId), eq(sub_statement.period_from, p.from), eq(sub_statement.period_to, p.to)));
  return { ...rollUp(rows, p), answer: answer ? { status: answer.status, note: answer.note, disputed_line: answer.disputed_line, responded_at: answer.responded_at } : null };
}

/** Every sub company's statement status for a period, for the office. */
export async function statementStatuses(tx: Tx, from: string, to: string) {
  return tx.select({ sub_company_id: sub_statement.sub_company_id, status: sub_statement.status, note: sub_statement.note, disputed_line: sub_statement.disputed_line, responded_at: sub_statement.responded_at })
    .from(sub_statement).where(and(eq(sub_statement.period_from, from), eq(sub_statement.period_to, to)));
}

/** The sub answers: it looks right, or a line is wrong and why. A later answer replaces an earlier one. */
export async function answerStatement(sub: SubCompany, from: string, to: string, b: { status: 'acknowledged' | 'disputed'; note?: string | null; disputed_line?: string | null }) {
  if (b.status === 'disputed' && !b.note?.trim()) throw new HttpError(422, 'Say what looks wrong so the office can fix it.');
  const values = { tenant_id: sub.tenant_id, sub_company_id: sub.id, period_from: from, period_to: to, status: b.status, note: b.note?.trim() || null, disputed_line: b.status === 'disputed' ? b.disputed_line?.slice(0, 500) || null : null, responded_at: new Date().toISOString() };
  await serviceDb().insert(sub_statement).values(values).onConflictDoUpdate({ target: [sub_statement.sub_company_id, sub_statement.period_from, sub_statement.period_to], set: { status: values.status, note: values.note, disputed_line: values.disputed_line, responded_at: values.responded_at } });
  return { ok: true };
}

/**
 * What the sub sees of its own work: runs and visits by its drivers with the lot's name and address (to find it), the
 * proof captured, and photo ids for its own visits. No customer names, phone numbers, emails, prices or other crews.
 */
export async function portalVisits(sub: SubCompany, p: Period) {
  const rows = (await serviceDb().execute(sql`
    select v.id, c.name as driver, s.name as storm, s.started_at, st.label as site, st.address, v.arrived_device_at as arrived, v.departed_device_at as departed,
      v.depth_in, v.arrive_lat is not null as gps,
      coalesce((select json_agg(json_build_object('id', p.id, 'phase', p.phase) order by p.received_at) from visit_photo p where p.visit_id = v.id and coalesce(p.phase, '') <> 'issue'), '[]'::json) as photos
    from visit v join crew_member c on c.id = v.crew_id join storm s on s.id = v.storm_id join site st on st.id = v.site_id
    where v.tenant_id = ${sub.tenant_id} and c.sub_company_id = ${sub.id} and s.started_at >= ${p.startAt} and s.started_at < ${p.endAt}
      and not exists (select 1 from visit_correction k where k.visit_id = v.id and k.field = 'voided' and k.new_value = 'true'::jsonb)
    order by s.started_at desc, v.arrived_device_at
    limit 1000`)) as unknown as { id: string; driver: string; storm: string; started_at: string; site: string; address: string | null; arrived: string; departed: string | null; depth_in: string | null; gps: boolean; photos: { id: string; phase: string }[] }[];
  return rows.map((r) => ({ ...r, depth_in: r.depth_in === null ? null : Number(r.depth_in) }));
}

/** A photo is only reachable through the portal of the sub whose driver took it. */
export async function subPhotoPath(sub: SubCompany, photoId: string): Promise<{ storage_path: string; width: number | null } | null> {
  const [p] = (await serviceDb().execute(sql`
    select p.storage_path, p.width from visit_photo p join visit v on v.id = p.visit_id join crew_member c on c.id = v.crew_id
    where p.id = ${photoId} and p.tenant_id = ${sub.tenant_id} and c.sub_company_id = ${sub.id} and coalesce(p.phase, '') <> 'issue'`)) as unknown as { storage_path: string; width: number | null }[];
  return p ?? null;
}

export interface Scorecard { sub_company_id: string; name: string; visits: number; with_deadline: number; on_time: number; pct_on_time: number | null; full_proof: number; pct_full_proof: number | null; problems: number; late_lots: number }

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * A season's scorecard per sub company: visits, on time against each lot's open-by, full proof (GPS, depth and before
 * and after photos), problems reported and lots reached late.
 */
export async function scorecards(tx: Tx, p: Period, tz: string): Promise<Scorecard[]> {
  const subs = await tx.select({ id: sub_company.id, name: sub_company.name }).from(sub_company).orderBy(asc(sub_company.name));
  if (!subs.length) return [];
  const visits = (await tx.execute(sql`
    select c.sub_company_id, v.site_id, s.started_at, v.arrived_device_at as arrived, st.service_window as window,
      v.arrive_lat is not null as gps, v.depth_in is not null as depth,
      exists (select 1 from visit_photo p where p.visit_id = v.id and p.phase = 'before') and exists (select 1 from visit_photo p where p.visit_id = v.id and p.phase = 'after') as photos
    from visit v join crew_member c on c.id = v.crew_id join storm s on s.id = v.storm_id join site st on st.id = v.site_id
    where c.sub_company_id is not null and v.departed_device_at is not null and s.started_at >= ${p.startAt} and s.started_at < ${p.endAt}
      and not exists (select 1 from visit_correction k where k.visit_id = v.id and k.field = 'voided' and k.new_value = 'true'::jsonb)`)) as unknown as { sub_company_id: string; site_id: string; started_at: string; arrived: string; window: { open_by?: string } | null; gps: boolean; depth: boolean; photos: boolean }[];
  const problems = (await tx.execute(sql`
    select c.sub_company_id, count(*)::int as n from problem_report pr join crew_member c on c.id = pr.crew_id join storm_run r on r.id = pr.storm_run_id join storm s on s.id = r.storm_id
    where c.sub_company_id is not null and s.started_at >= ${p.startAt} and s.started_at < ${p.endAt} group by c.sub_company_id`)) as unknown as { sub_company_id: string; n: number }[];
  return subs.map((s) => {
    const mine = visits.filter((v) => v.sub_company_id === s.id);
    const timed = mine.filter((v) => v.window?.open_by);
    const late = timed.filter((v) => isLate(v.window as never, Date.parse(v.started_at), Date.parse(v.arrived), tz));
    const full = mine.filter((v) => v.gps && v.depth && v.photos).length;
    return {
      sub_company_id: s.id, name: s.name, visits: mine.length, with_deadline: timed.length, on_time: timed.length - late.length, pct_on_time: pct(timed.length - late.length, timed.length),
      full_proof: full, pct_full_proof: pct(full, mine.length), problems: problems.find((x) => x.sub_company_id === s.id)?.n ?? 0, late_lots: new Set(late.map((v) => v.site_id)).size,
    };
  });
}

export function scorecardCsv(rows: Scorecard[], p: Pick<Period, 'from' | 'to'>): string {
  const esc = (v: string | number | null) => { const t = v === null ? '' : String(v); return /[",\r\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [`Sub company scorecard,${p.from} to ${p.to}`, 'Sub company,Visits,With an open-by time,On time,On time %,Full proof,Full proof %,Problems reported,Lots reached late'];
  for (const r of rows) lines.push([r.name, r.visits, r.with_deadline, r.on_time, r.pct_on_time, r.full_proof, r.pct_full_proof, r.problems, r.late_lots].map(esc).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The insurance gate (issue 226): when the company turns on "Block subs with an expired or missing certificate", a
 * sub driver whose certificate has ended or was never added can't be put on a storm run. Off, the dashboard warns as
 * before. A certificate filed under any driver of the same sub company covers the whole company.
 */
export async function lapsedSubs(tx: Tx, tenantId: string, crewIds: (string | null | undefined)[]): Promise<{ id: string; name: string; coverage: string }[]> {
  const ids = [...new Set(crewIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const [t] = await serviceDb().select({ block: tenant.block_lapsed_coi, tz: tenant.timezone }).from(tenant).where(eq(tenant.id, tenantId));
  if (!t?.block) return [];
  const crew = await tx.select({ id: crew_member.id, name: crew_member.name, kind: crew_member.kind, sub_company_id: crew_member.sub_company_id }).from(crew_member).where(and(inArray(crew_member.id, ids), eq(crew_member.active, true)));
  const subs = crew.filter((c) => c.kind === 'sub');
  if (!subs.length) return [];
  const companies = [...new Set(subs.map((c) => c.sub_company_id).filter((x): x is string => !!x))];
  const mates = companies.length ? await tx.select({ id: crew_member.id, sub_company_id: crew_member.sub_company_id }).from(crew_member).where(inArray(crew_member.sub_company_id, companies)) : [];
  const holders = [...new Set([...subs.map((c) => c.id), ...mates.map((m) => m.id)])];
  const certs = await tx.select({ crew_id: certificate.crew_id, kind: certificate.kind, expires_on: certificate.expires_on }).from(certificate).where(inArray(certificate.crew_id, holders));
  const today = localDay(new Date(), t.tz);
  const out: { id: string; name: string; coverage: string }[] = [];
  for (const c of subs) {
    const team = c.sub_company_id ? mates.filter((m) => m.sub_company_id === c.sub_company_id).map((m) => m.id) : [];
    const mine = certs.filter((x) => x.crew_id === c.id || team.includes(x.crew_id ?? ''));
    const cover = subCoverage(mine, today);
    if (cover === 'expired' || cover === 'missing') out.push({ id: c.id, name: c.name, coverage: cover });
  }
  return out;
}

/** Throws the clear refusal the office sees, naming who and why. */
export async function requireCoveredSubs(tx: Tx, tenantId: string, crewIds: (string | null | undefined)[]) {
  const lapsed = await lapsedSubs(tx, tenantId, crewIds);
  if (!lapsed.length) return;
  const why = (c: { name: string; coverage: string }) => `${c.name} (${c.coverage === 'missing' ? 'no certificate on file' : 'certificate ended'})`;
  throw new HttpError(409, `Your company blocks subs without current insurance from storm runs: ${lapsed.map(why).join(', ')}. Add their certificate in Compliance, pick another driver, or turn the block off in Settings, Crew.`, 'sub_coi_lapsed');
}
