import { csvText } from '@flake/core/qbo';
import { serviceDb, sql } from '@flake/db';

/**
 * The insurance renewal pack (issue 236): evidence across the whole book that the company documents its work, for an
 * agent and underwriter at renewal. Counts the same visits proof packets list (finished, not voided) for storms that
 * started in the range, so the pack agrees with a packet for the same lot and dates.
 */
export interface RenewalSite { site_id: string; site: string; customer: string; visits: number; gps: number; photos: number; depth: number; salt_tons: number }
export interface RenewalPack {
  from: string; to: string; company: string;
  storms: number; visits: number;
  pct_gps: number | null; pct_photos: number | null; pct_depth: number | null;
  salt_tons: number; salt_runs: number;
  avg_response_min: number | null;
  claims: { status: string; n: number }[];
  coi: { insurer: string | null; policy_number: string | null; expires_on: string | null } | null;
  sites: RenewalSite[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const TONS: Record<string, number> = { ton: 1, bag50lb: 0.025, lb: 0.0005 };

export async function renewalPack(tenantId: string, from: string, to: string): Promise<RenewalPack> {
  const db = serviceDb();
  const range = sql`s.started_at >= ${from}::date and s.started_at < (${to}::date + 1)`;
  const [t] = (await db.execute(sql`select name from tenant where id = ${tenantId}`)) as unknown as { name: string }[];
  const [storms] = (await db.execute(sql`select count(*)::int as n from storm s where s.tenant_id = ${tenantId} and ${range}`)) as unknown as { n: number }[];
  const visits = (await db.execute(sql`
    select v.id, v.site_id, st.label as site, c.name as customer, v.arrive_lat is not null as gps, v.depth_in is not null as depth, v.salt,
      exists (select 1 from visit_photo p where p.visit_id = v.id and p.phase = 'before') and exists (select 1 from visit_photo p where p.visit_id = v.id and p.phase = 'after') as photos
    from visit v join storm s on s.id = v.storm_id join site st on st.id = v.site_id join customer c on c.id = st.customer_id
    where v.tenant_id = ${tenantId} and v.departed_device_at is not null and ${range}
      and not exists (select 1 from visit_correction vc where vc.visit_id = v.id and vc.field = 'voided' and vc.new_value = 'true'::jsonb)`)) as unknown as { id: string; site_id: string; site: string; customer: string; gps: boolean; depth: boolean; photos: boolean; salt: { unit: string; qty: number }[] | null }[];
  const tons = (salt: { unit: string; qty: number }[] | null) => (salt ?? []).reduce((a, e) => a + (TONS[e.unit] ?? 0) * Number(e.qty || 0), 0);
  const [runs] = (await db.execute(sql`select count(*)::int as n from trigger_alert a where a.tenant_id = ${tenantId} and a.kind in ('salt_run', 'refreeze') and a.created_at >= ${from}::date and a.created_at < (${to}::date + 1)`)) as unknown as { n: number }[];
  // From the alert to the first truck on a lot, for storms started from a trigger alert.
  const [resp] = (await db.execute(sql`
    select avg(extract(epoch from (first_arrive - a.created_at)) / 60)::float as m from (
      select s.trigger_alert_id, min(v.arrived_device_at) as first_arrive from storm s join visit v on v.storm_id = s.id
      where s.tenant_id = ${tenantId} and s.trigger_alert_id is not null and ${range} group by s.trigger_alert_id
    ) x join trigger_alert a on a.id = x.trigger_alert_id where first_arrive > a.created_at`)) as unknown as { m: number | null }[];
  const claims = (await db.execute(sql`select status, count(*)::int as n from claim where tenant_id = ${tenantId} and incident_at >= ${from}::date and incident_at < (${to}::date + 1) group by status order by status`)) as unknown as { status: string; n: number }[];
  const [coi] = (await db.execute(sql`select insurer, policy_number, expires_on::text as expires_on from certificate where tenant_id = ${tenantId} and crew_id is null and is_default order by expires_on desc nulls last limit 1`)) as unknown as RenewalPack['coi'][];
  const bySite = new Map<string, RenewalSite>();
  for (const v of visits) {
    const r = bySite.get(v.site_id) ?? { site_id: v.site_id, site: v.site, customer: v.customer, visits: 0, gps: 0, photos: 0, depth: 0, salt_tons: 0 };
    r.visits++;
    if (v.gps) r.gps++;
    if (v.photos) r.photos++;
    if (v.depth) r.depth++;
    r.salt_tons += tons(v.salt);
    bySite.set(v.site_id, r);
  }
  const n = visits.length;
  return {
    from, to, company: t?.name ?? '', storms: storms?.n ?? 0, visits: n,
    pct_gps: pct(visits.filter((v) => v.gps).length, n), pct_photos: pct(visits.filter((v) => v.photos).length, n), pct_depth: pct(visits.filter((v) => v.depth).length, n),
    salt_tons: Math.round(visits.reduce((a, v) => a + tons(v.salt), 0) * 100) / 100, salt_runs: runs?.n ?? 0,
    avg_response_min: resp?.m == null ? null : Math.round(resp.m), claims, coi: coi ?? null,
    sites: [...bySite.values()].map((r) => ({ ...r, salt_tons: Math.round(r.salt_tons * 100) / 100 })).sort((a, b) => a.customer.localeCompare(b.customer) || a.site.localeCompare(b.site)),
  };
}

export function renewalCsv(p: RenewalPack): string {
  const rows: (string | number)[][] = [
    ['Insurance renewal pack', p.company], ['From', p.from], ['To', p.to], ['Storms', p.storms], ['Visits', p.visits],
    ['Visits with GPS %', p.pct_gps ?? ''], ['Visits with before and after photos %', p.pct_photos ?? ''], ['Visits with snow depth %', p.pct_depth ?? ''],
    ['Salt applied (tons)', p.salt_tons], ['Salt and refreeze runs', p.salt_runs], ['Average minutes from alert to first truck', p.avg_response_min ?? ''],
    ...p.claims.map((c) => [`Claims ${c.status}`, c.n]), [],
    ['Customer', 'Site', 'Visits', 'With GPS', 'With before and after photos', 'With depth', 'Salt (tons)'],
    ...p.sites.map((s) => [s.customer, s.site, s.visits, s.gps, s.photos, s.depth, s.salt_tons]),
  ];
  return `${rows.map((r) => r.map((v) => csvText(String(v))).join(',')).join('\r\n')}\r\n`;
}
