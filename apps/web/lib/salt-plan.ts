import { saltTons } from '@flake/core/reports';
import type { ContractService } from '@flake/core/pricing';
import { summarize } from '@flake/core/trigger';
import { currentSeason, liveContracts } from '@flake/core/time';
import { and, contract, desc, eq, serviceDb, site, sql, tenant } from '@flake/db';
import { getSetting, weatherNow } from './providers';
import { latestGrids, seriesFromSummary } from './weather';
import { yardStock } from './yards';

/** Tons per 1,000 sq ft per salting when a lot has no history yet: about a ton an acre. */
export const TONS_PER_1000_SQFT = 1 / 43.56;
/** Salt runs in a typical season, for the pre-season estimate, until the owner says otherwise. */
export const DEFAULT_EVENTS = 12;
export const saltEventsKey = (tenantId: string) => `salt_events:${tenantId}`;

export interface LotSalt {
  site_id: string; label: string; sqft: number | null;
  storms: number; visits: number; tons: number;
  /** Tons per salting: this lot's own average, or the size estimate. */
  per_event: number | null; per_event_from: 'history' | 'size' | null;
  per_1000_sqft: number | null;
  forecast_in: number | null;
}

/**
 * Salt as its own part of Flake (issue 197, phase 1): what each salt lot used this season, what the next forecast storm
 * will need against what's on hand, and a pre-season estimate. Logged bags count as 50 lb; "applications" have no weight.
 */
export async function saltPlan(tenantId: string) {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  if (!t) throw new Error('No company');
  const season = currentSeason(new Date(), t.timezone);
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true)));
  const live = liveContracts(await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at)), new Date(), t.timezone);
  const saltLots = new Set(live.filter((c) => ((c.services ?? []) as ContractService[]).some((s) => s.service === 'salt')).map((c) => c.site_id));
  // Every salted visit this season and before, per lot: the corrected amount when the office fixed it.
  const visits = (await db.execute(sql`
    select v.site_id, v.storm_id, s.started_at,
      coalesce((select c.new_value from visit_correction c where c.visit_id = v.id and c.field = 'salt' order by c.created_at desc limit 1), v.salt) as salt
    from visit v join storm s on s.id = v.storm_id
    where v.tenant_id = ${tenantId} and v.departed_device_at is not null
      and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)`)) as unknown as { site_id: string; storm_id: string; started_at: string; salt: { unit: string; qty: number }[] | null }[];
  const tonsOf = (salt: { unit: string; qty: number }[] | null) => (salt ?? []).reduce((n, e) => n + (saltTons(e.unit, Number(e.qty)) ?? 0), 0);
  const thisSeason = (at: string) => currentSeason(new Date(at), t.timezone) === season;
  const latest = await latestGrids(sites.map((s) => ({ office: s.nws_office, x: s.nws_grid_x, y: s.nws_grid_y })));
  const now = (await weatherNow()).getTime();

  const lots: LotSalt[] = sites.filter((s) => saltLots.has(s.id) || visits.some((v) => v.site_id === s.id && tonsOf(v.salt) > 0)).map((s) => {
    const mine = visits.filter((v) => v.site_id === s.id && tonsOf(v.salt) > 0);
    const season_ = mine.filter((v) => thisSeason(v.started_at));
    const tons = season_.reduce((n, v) => n + tonsOf(v.salt), 0);
    const sqft = s.area_confirmed_sqft ?? s.area_estimate_sqft ?? null;
    const history = mine.length ? mine.reduce((n, v) => n + tonsOf(v.salt), 0) / mine.length : null;
    const bySize = sqft ? (Number(sqft) / 1000) * TONS_PER_1000_SQFT : null;
    const snap = latest.get(`${s.nws_office}/${s.nws_grid_x}/${s.nws_grid_y}`);
    return {
      site_id: s.id, label: s.label, sqft: sqft === null ? null : Number(sqft),
      storms: new Set(season_.map((v) => v.storm_id)).size, visits: season_.length, tons: round2(tons),
      per_event: history !== null ? round2(history) : bySize !== null ? round2(bySize) : null,
      per_event_from: (history !== null ? 'history' : bySize !== null ? 'size' : null) as LotSalt['per_event_from'],
      per_1000_sqft: sqft && history !== null ? round2(history / (Number(sqft) / 1000)) : null,
      forecast_in: snap ? summarize(seriesFromSummary(snap.summary), now).snow_next12h_in : null,
    };
  }).sort((a, b) => b.tons - a.tons || a.label.localeCompare(b.label));

  const yards = await yardStock(tenantId);
  const onHand = round2(yards.reduce((n, y) => n + y.tons, 0));
  const counted = yards.some((y) => y.since);
  // The next storm: salt lots with snow in the next 12 hours each need their usual salting.
  const coming = lots.filter((l) => saltLots.has(l.site_id) && (l.forecast_in ?? 0) > 0);
  const need = round2(coming.reduce((n, l) => n + (l.per_event ?? 0), 0));
  const events = (await getSetting<{ events: number }>(saltEventsKey(tenantId)))?.events ?? DEFAULT_EVENTS;
  const perEventAll = lots.filter((l) => saltLots.has(l.site_id)).reduce((n, l) => n + (l.per_event ?? 0), 0);
  return {
    season,
    lots,
    on_hand: counted ? onHand : null,
    next_storm: coming.length ? { lots: coming.length, need_tons: need, short_tons: counted ? round2(Math.max(0, need - onHand)) : null } : null,
    season_estimate: { events, tons: round2(perEventAll * events), salt_lots: saltLots.size },
    used_this_season: round2(lots.reduce((n, l) => n + l.tons, 0)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
