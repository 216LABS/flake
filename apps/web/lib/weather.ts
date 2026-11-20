import { gzipSync } from 'node:zlib';
import { and, app_setting, asc, contract, desc, driver_action, eq, gte, inArray, lte, or, serviceDb, site, sql, storm, tenant, trigger_alert, weather_snapshot } from '@flake/db';
import { blendNowcast, percentilesOver, expandSeries, evaluateSite, groupDecisions, alertHeadline, serviceArea, newWinterAlerts, summarize, sumOverlap, triggerLine, toFahrenheit, toInches, type DepthReport, type HourBucket, type NwsAlert, type SiteDecision, type TriggerSite, type WeatherSeries } from '@flake/core/trigger';
import type { ContractService } from '@flake/core/pricing';
import { cityOf } from '@flake/core/address';
import { fmtLocal, liveContracts } from '@flake/core/time';
import type { FetchedDoc, NbmResult, NowcastResult, RadarResult } from '@flake/providers';
import { putBlob } from './blob';
import { baseUrl } from './env';
import { enqueue } from './jobs';
import { log } from './log';
import { notifyOffice } from './messaging';
import { getProviders, getSetting, setSetting, weatherNow } from './providers';
import { saltRuleFor, saltSettings } from './salt-triggers';
import { sha256Hex } from './tokens';

const HOUR = 3600 * 1000;
type Summary = Record<string, any>;

export const REMAP_AFTER_MS = 7 * 24 * HOUR;

/** Parses an NWS gridpoint document into hourly series. Missing layers stay empty, which reads as unavailable. */
export function parseGridpoint(json: any): WeatherSeries {
  const p = json?.properties ?? {};
  const layer = (name: string, convert: (v: number, uom: string) => number, prorate: boolean): HourBucket[] => {
    const l = p[name];
    return l?.values ? expandSeries(l.values, (v) => convert(v, l.uom), prorate) : [];
  };
  return { snowIn: layer('snowfallAmount', toInches, true), iceIn: layer('iceAccumulation', toInches, true), tempF: layer('temperature', toFahrenheit, false) };
}

const packBuckets = (b: HourBucket[], from: number, to: number) => b.filter((x) => x.t >= from && x.t < to).map((x) => [x.t, x.v === null ? null : Math.round(x.v * 1000) / 1000]);
const unpack = (rows: [number, number | null][] | undefined): HourBucket[] => (rows ?? []).map(([t, v]) => ({ t, v }));
export const seriesFromSummary = (s: Summary): WeatherSeries => ({ snowIn: unpack(s.hourly?.snow), iceIn: unpack(s.hourly?.ice), tempF: unpack(s.hourly?.temp) });

async function archive(source: string, key: string, fetchedAt: Date, raw: Uint8Array, ext = 'json'): Promise<{ path: string; sha256: string }> {
  const path = `${source}/${key}/${fetchedAt.toISOString().replace(/[:.]/g, '-')}-${sha256Hex(raw).slice(0, 8)}.${ext}.gz`;
  await putBlob('weather-archive', path, gzipSync(raw), 'application/gzip', { upsert: true });
  return { path, sha256: sha256Hex(raw) };
}

async function insertSnapshot(values: { source: string; office?: string | null; grid_x?: number | null; grid_y?: number | null; station?: string | null; fetchedAt: Date; lastModified: string | null; url: string; path: string; sha256: string; summary: Summary }) {
  const [row] = await serviceDb().insert(weather_snapshot).values({
    source: values.source,
    office: values.office ?? null,
    grid_x: values.grid_x ?? null,
    grid_y: values.grid_y ?? null,
    station: values.station ?? null,
    fetched_at: values.fetchedAt.toISOString(),
    last_modified: values.lastModified ? new Date(values.lastModified).toISOString() : null,
    request_url: values.url,
    storage_path: values.path,
    sha256: values.sha256,
    summary: values.summary,
  }).returning();
  return row!;
}

// Circuit breaker: 5 consecutive failures pause polling for 10 minutes and surface on the dashboard.
interface Breaker { failures: number; open_until: string | null }
export const breakerState = async () => (await getSetting<Breaker>('weather_breaker')) ?? { failures: 0, open_until: null };
export const breakerOpen = (b: Breaker, now = Date.now()) => Boolean(b.open_until && Date.parse(b.open_until) > now);

async function recordFailure() {
  const b = await breakerState();
  const failures = b.failures + 1;
  await setSetting('weather_breaker', { failures, open_until: failures >= 5 ? new Date(Date.now() + 10 * 60000).toISOString() : b.open_until });
}
async function recordSuccess() {
  await serviceDb().update(app_setting).set({ value: { failures: 0, open_until: null } }).where(eq(app_setting.key, 'weather_breaker'));
}

type Cell = { office: string | null; x: number | null; y: number | null };
const cellKey = (office: string | null, x: number | null, y: number | null) => `${office}/${x}/${y}`;

/**
 * The newest forecast snapshot for each grid cell, in one query rather than one per cell (issue 185). Keyed by
 * office/x/y; a cell with no snapshot yet is simply absent.
 */
export async function latestGrids(cells: Cell[]) {
  const wanted = [...new Map(cells.filter((c) => c.office && c.x !== null && c.y !== null).map((c) => [cellKey(c.office, c.x, c.y), c])).values()];
  const out = new Map<string, typeof weather_snapshot.$inferSelect>();
  if (!wanted.length) return out;
  const rows = await serviceDb().selectDistinctOn([weather_snapshot.office, weather_snapshot.grid_x, weather_snapshot.grid_y]).from(weather_snapshot)
    .where(and(eq(weather_snapshot.source, 'nws_grid'), or(...wanted.map((c) => and(eq(weather_snapshot.office, c.office!), eq(weather_snapshot.grid_x, c.x!), eq(weather_snapshot.grid_y, c.y!))))))
    .orderBy(asc(weather_snapshot.office), asc(weather_snapshot.grid_x), asc(weather_snapshot.grid_y), desc(weather_snapshot.fetched_at));
  for (const r of rows) out.set(cellKey(r.office, r.grid_x, r.grid_y), r);
  return out;
}

/** The owner's names for lots' service areas (issue 198), kept as a setting: { site_id: area name }. */
export const areasKey = (tenantId: string) => `areas:${tenantId}`;
export async function areaOverrides(tenantId: string): Promise<Record<string, string>> {
  return (await getSetting<Record<string, string>>(areasKey(tenantId))) ?? {};
}
/** Each lot's area: the owner's name for it, else its city. "LAKEWOOD", "Lakewood" and "lakewood" are one area (issue 206). */
export async function areasFor(tenantId: string, sites: { id: string; address: string }[]) {
  const named = await areaOverrides(tenantId);
  return sameAreas(sites.map((s) => [s.id, serviceArea(s.address, named[s.id])] as const), Object.values(named));
}
/** One spelling per area, ignoring case: the owner's own spelling if they named one, else the first seen. */
export function sameAreas(pairs: (readonly [string, string])[], preferred: string[] = []) {
  const spelling = new Map<string, string>();
  for (const name of [...preferred.map((n) => n.trim()).filter(Boolean), ...pairs.map(([, a]) => a)]) if (!spelling.has(name.toLowerCase())) spelling.set(name.toLowerCase(), name);
  return new Map(pairs.map(([id, a]) => [id, spelling.get(a.toLowerCase())!]));
}

/** Maps sites to an NWS grid cell on first sight and every 7 days after. */
export async function mapSites(tenantId?: string, force = false) {
  const { weather } = await getProviders();
  const cutoff = new Date(Date.now() - REMAP_AFTER_MS).toISOString();
  const rows = await serviceDb().select({ id: site.id, lat: site.lat, lon: site.lon }).from(site).where(and(
    eq(site.active, true),
    tenantId ? eq(site.tenant_id, tenantId) : undefined,
    force ? undefined : sql`(${site.nws_mapped_at} is null or ${site.nws_mapped_at} < ${cutoff})`,
  ));
  for (const s of rows) {
    // One site that won't map must not stop the rest. It retries on the next run.
    try {
      const g = await weather.pointToGrid(s.lat, s.lon);
      await serviceDb().update(site).set({ nws_office: g.office, nws_grid_x: g.gridX, nws_grid_y: g.gridY, nws_station: g.station, nws_mapped_at: new Date().toISOString() }).where(eq(site.id, s.id));
    } catch (err) {
      // A lot outside the NWS's area (across the border, offshore, or a pin dropped in the wrong place) answers 404 on
      // every try. It's marked checked with no forecast area, so it neither retries every run nor trips the breaker
      // that pauses weather for every company.
      if (/NWS 404/.test(err instanceof Error ? err.message : String(err))) {
        await serviceDb().update(site).set({ nws_office: null, nws_grid_x: null, nws_grid_y: null, nws_station: null, nws_mapped_at: new Date().toISOString() }).where(eq(site.id, s.id));
        log.info('site outside NWS coverage', { site_id: s.id });
        continue;
      }
      log.error('site grid mapping failed', err, { site_id: s.id });
      await recordFailure();
    }
  }
  return rows.length;
}

/** /api/cron/weather: 60 min normally, 15 min when snow is forecast within 24 h or an alert is active. */
export async function scheduleWeather() {
  const breaker = await breakerState();
  if (breakerOpen(breaker)) return { skipped: 'breaker_open', cells: 0 };
  await mapSites();
  const now = await weatherNow();
  const cells = await serviceDb().selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(and(eq(site.active, true), sql`${site.nws_office} is not null`));
  let queued = 0;
  let stormy = false;
  const latest = await latestGrids(cells);
  for (const c of cells) {
    const last = latest.get(cellKey(c.office, c.x, c.y));
    const age = last ? Date.now() - Date.parse(last.fetched_at) : Infinity;
    const busy = last ? Boolean(last.summary.alerts?.length) || (summarize(seriesFromSummary(last.summary), now.getTime() + 12 * HOUR).snow_next12h_in ?? 0) > 0 || (summarize(seriesFromSummary(last.summary), now.getTime()).snow_next12h_in ?? 0) > 0 : true;
    stormy ||= busy;
    if (age > 60 * 60000 || (busy && age > 15 * 60000)) {
      await enqueue('weather.fetch_cell', { office: c.office, x: c.x, y: c.y }, { dedupeKey: `cell:${c.office}:${c.x}:${c.y}:${Math.floor(Date.now() / (15 * 60000))}` });
      queued++;
    }
  }
  const tenants = await serviceDb().selectDistinct({ id: site.tenant_id }).from(site).where(eq(site.active, true));
  for (const t of tenants) await enqueue('weather.fetch_alerts', { tenantId: t.id }, { dedupeKey: `alerts:${t.id}:${Math.floor(Date.now() / (15 * 60000))}` });
  // Issue 203. The Blend is checked hourly and only downloaded when a new run with percentiles is out (4 a day). HRRR
  // and radar only while snow is near or a storm is running. Each covers every lot in one pass.
  const hour = Math.floor(Date.now() / HOUR);
  if (cells.length) {
    await enqueue('weather.nbm', {}, { dedupeKey: `nbm:${hour}` });
    const [running] = await serviceDb().select({ id: storm.id }).from(storm).where(eq(storm.status, 'active')).limit(1);
    if (stormy || running) {
      await enqueue('weather.nowcast', {}, { dedupeKey: `nowcast:${hour}` });
      await enqueue('weather.radar', {}, { dedupeKey: `radar:${hour}` });
    }
  }
  return { cells: queued, tenants: tenants.length };
}

/** weather.fetch_cell: conditional GET, archive raw, snapshot, then evaluate every tenant in the cell. */
export async function fetchCell(office: string, x: number, y: number) {
  const { weather } = await getProviders();
  const now = await weatherNow();
  const [last] = await serviceDb().select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, office), eq(weather_snapshot.grid_x, x), eq(weather_snapshot.grid_y, y))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
  let doc;
  try {
    doc = await weather.fetchGridpoint(office, x, y, last?.last_modified);
    await recordSuccess();
  } catch (err) {
    // NWS can renumber its grid. A 404 means re-map these sites on the next run, not that the service is down.
    if (err instanceof Error && err.message.startsWith('NWS 404')) {
      await serviceDb().update(site).set({ nws_mapped_at: null }).where(and(eq(site.nws_office, office), eq(site.nws_grid_x, x), eq(site.nws_grid_y, y)));
    } else {
      await recordFailure();
    }
    throw err;
  }
  if (!doc.notModified) {
    const series = parseGridpoint(doc.json);
    const { path, sha256 } = await archive('nws_grid', `${office}/${x},${y}`, now, doc.raw);
    const from = now.getTime() - 48 * HOUR;
    const to = now.getTime() + 72 * HOUR;
    await insertSnapshot({
      source: 'nws_grid', office, grid_x: x, grid_y: y, fetchedAt: now, lastModified: doc.lastModified, url: doc.url, path, sha256,
      summary: { ...summarize(series, now.getTime()), alerts: [], ...(doc.synthetic ? { synthetic: true } : {}), hourly: { snow: packBuckets(series.snowIn, from, to), ice: packBuckets(series.iceIn, from, to), temp: packBuckets(series.tempF, from, to) } },
    });
  }
  const tenants = await serviceDb().selectDistinct({ id: site.tenant_id }).from(site).where(and(eq(site.nws_office, office), eq(site.nws_grid_x, x), eq(site.nws_grid_y, y), eq(site.active, true)));
  for (const t of tenants) await enqueue('trigger.evaluate', { tenantId: t.id });
}

const areaName = (addresses: string[]) => {
  const counts = new Map<string, number>();
  for (const a of addresses) {
    const city = cityOf(a);
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Your area';
};

async function notifyOwners(t: typeof tenant.$inferSelect, alertId: string, headline: string, revision = 0) {
  const link = `${baseUrl()}/alerts/${alertId}`;
  const related = { alert_id: alertId };
  return notifyOffice(t, { headline, link, key: revision ? `alert:${alertId}:${revision}` : `alert:${alertId}`, related });
}

/** Issue 203's sources, by the snapshot source they're stored as. */
export const MODEL_SOURCE = { nbm: 'nbm', nowcast: 'nowcast', radar: 'mrms' } as const;
type ModelKind = keyof typeof MODEL_SOURCE;
/** How old a run can be and still count: a Blend run covers 24 h ahead, HRRR 6 h, radar is the last hour. */
const MODEL_MAX_AGE_MS: Record<ModelKind, number> = { nbm: 12 * HOUR, nowcast: 3 * HOUR, radar: 2 * HOUR };

/**
 * weather.nbm / weather.nowcast / weather.radar: one fetch for every active lot, archived and stored as a snapshot,
 * then every company's triggers are checked again. A source that's down is logged and skipped. It never trips the NWS
 * breaker, so the NWS grid keeps alerting on its own (issue 203).
 */
export async function fetchModel(kind: ModelKind) {
  const db = serviceDb();
  const points = await db.select({ id: site.id, lat: site.lat, lon: site.lon }).from(site).where(eq(site.active, true));
  if (!points.length) return null;
  const { weather } = await getProviders();
  const now = await weatherNow();
  const source = MODEL_SOURCE[kind];
  // The newest run stored up to now: the demo's clock can be moved back, and a run stored "later" doesn't count then.
  const [last] = await db.select({ summary: weather_snapshot.summary }).from(weather_snapshot).where(and(eq(weather_snapshot.source, source), lte(weather_snapshot.fetched_at, now.toISOString()))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
  let result: NbmResult | NowcastResult | RadarResult | null;
  try {
    result = kind === 'nbm' ? await weather.fetchNbm(now, points, last?.summary.cycle) : kind === 'nowcast' ? await weather.fetchNowcast(now, points, last?.summary.cycle) : await weather.fetchRadar(now, points);
  } catch (err) {
    log.error(`${kind} unavailable, NWS grid only`, err);
    return null;
  }
  if (!result) return null;
  const key = 'cycle' in result ? result.cycle : result.validAt;
  const { path, sha256 } = await archive(source, key.replace(/[:.]/g, '-'), now, result.raw);
  const summary = 'windows' in result ? { cycle: result.cycle, windows: result.windows, sites: result.samples }
    : 'hours' in result ? { cycle: result.cycle, hours: result.hours, sites: result.samples }
    : { valid_at: result.validAt, sites: result.samples };
  const snap = await insertSnapshot({ source, fetchedAt: now, lastModified: null, url: result.url, path, sha256, summary: { ...summary, ...(result.synthetic ? { synthetic: true } : {}) } });
  if (kind !== 'radar') {
    const tenants = await db.selectDistinct({ id: site.tenant_id }).from(site).where(eq(site.active, true));
    for (const t of tenants) await enqueue('trigger.evaluate', { tenantId: t.id }, { dedupeKey: `evaluate:${t.id}:${kind}:${key}` });
  }
  return snap;
}

export type Models = Partial<Record<ModelKind, typeof weather_snapshot.$inferSelect>>;

/** The newest run of each source, one query each for every lot (no per-lot lookups). Stale runs are left out. */
export async function latestModels(nowMs: number): Promise<Models> {
  const out: Models = {};
  for (const kind of Object.keys(MODEL_SOURCE) as ModelKind[]) {
    const [row] = await serviceDb().select().from(weather_snapshot)
      .where(and(eq(weather_snapshot.source, MODEL_SOURCE[kind]), gte(weather_snapshot.fetched_at, new Date(nowMs - MODEL_MAX_AGE_MS[kind]).toISOString()), lte(weather_snapshot.fetched_at, new Date(nowMs + HOUR).toISOString())))
      .orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    if (row) out[kind] = row;
  }
  return out;
}

/**
 * One lot's weather from every source: the NWS grid with HRRR's hours in place of its own during storms, the Blend's
 * percentiles for the next 12 hours, and radar's last hour. Whatever's missing is left out and the rest still works.
 */
export function lotWeather(gridSummary: Summary, models: Models, siteId: string, nowMs: number) {
  const cast = models.nowcast?.summary.sites?.[siteId];
  const series = blendNowcast(seriesFromSummary(gridSummary), cast ? { hours: models.nowcast!.summary.hours, snow: cast.snow, ice: cast.ice } : null);
  const nbmSite = models.nbm?.summary.sites?.[siteId];
  const nbm = nbmSite ? percentilesOver(models.nbm!.summary.windows, nbmSite, nowMs, nowMs + 12 * HOUR) : null;
  const radar = (models.radar?.summary.sites?.[siteId]?.last1h ?? null) as number | null;
  return { series, nbm, radar };
}

/**
 * What the trigger engine needs for each lot: the plow trigger and salt from the contract in force today, the salt run
 * rule (issue 204), and whether snow is still down. Null for a lot that can't trigger (no signed contract). Shared by
 * alerts, the dashboard's area rows and the triggers table, so all three agree.
 */
export async function triggerInputs(t: { id: string; timezone: string }, sites: { id: string; lat: number; lon: number }[], nowMs: number): Promise<Map<string, TriggerSite | null>> {
  const db = serviceDb();
  // Triggers come from the contract in force today, not a renewal signed for next winter. Today on the wall clock:
  // the demo's weather clock replays an old storm, and contracts are signed in real time.
  const contracts = liveContracts(await db.select().from(contract).where(and(eq(contract.tenant_id, t.id), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at)), new Date(), t.timezone);
  // Snow still on the ground for a refreeze: a storm this company ran in the last 3 days.
  const [recentStorm] = await db.select({ id: storm.id }).from(storm).where(and(eq(storm.tenant_id, t.id), gte(storm.started_at, new Date(nowMs - 72 * HOUR).toISOString()))).limit(1);
  const salt = await saltSettings(t.id);
  const out = new Map<string, TriggerSite | null>();
  for (const s of sites) {
    const services = (contracts.find((x) => x.site_id === s.id)?.services ?? []) as ContractService[];
    const triggers = services.map((x) => x.trigger_in).filter((v): v is number => typeof v === 'number');
    const input: TriggerSite = { site_id: s.id, lat: s.lat, lon: s.lon, trigger_in: triggers.length ? Math.min(...triggers) : null, has_salt: services.some((x) => x.service === 'salt'), salt: saltRuleFor(salt, s.id), snow_on_ground: Boolean(recentStorm) };
    out.set(s.id, input.trigger_in === null && !input.has_salt ? null : input);
  }
  return out;
}

/** trigger.evaluate: ADDENDUM_WEATHER section 3 for one tenant. Creates alerts only, never a dispatch. */
export async function evaluateTenant(tenantId: string): Promise<string[]> {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  if (!t) return [];
  const now = await weatherNow();
  const nowMs = now.getTime();
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true), sql`${site.nws_office} is not null`));
  if (!sites.length) return [];
  const siteCell = (s: { nws_office: string | null; nws_grid_x: number | null; nws_grid_y: number | null }) => cellKey(s.nws_office, s.nws_grid_x, s.nws_grid_y);
  const latest = await latestGrids(sites.map((s) => ({ office: s.nws_office, x: s.nws_grid_x, y: s.nws_grid_y })));
  const inputs = await triggerInputs(t, sites, nowMs);
  const models = await latestModels(nowMs);
  const depthRows = await db.select().from(driver_action).where(and(eq(driver_action.tenant_id, tenantId), eq(driver_action.kind, 'depth'), gte(driver_action.device_at, new Date(nowMs - 48 * HOUR).toISOString())));
  const reports: DepthReport[] = depthRows
    .filter((r) => typeof r.payload.lat === 'number')
    .map((r) => ({ lat: r.payload.lat, lon: r.payload.lon, depth_in: r.payload.depth_in, at: Date.parse(r.device_at) }));

  const decisions: SiteDecision[] = [];
  for (const s of sites) {
    const input = inputs.get(s.id);
    if (!input) continue;
    const snap = latest.get(siteCell(s));
    if (!snap) continue;
    const w = lotWeather(snap.summary, models, s.id, nowMs);
    decisions.push(...evaluateSite(input, w.series, nowMs, reports, { nbm: w.nbm }));
  }
  const prior = await db.select().from(trigger_alert).where(eq(trigger_alert.tenant_id, tenantId));
  const priorSends = prior.flatMap((a) => ((a.detail.sites ?? []) as SiteDecision[]).map((d) => ({ kind: a.kind!, site_id: d.site_id, event_key: d.event_key })));
  // Debounce on the evaluation clock so the demo's fake clock behaves like real time.
  const recent = prior.map((a) => ({ kind: a.kind!, created_at: a.detail.evaluated_at ? Date.parse(a.detail.evaluated_at) : Date.parse(a.created_at!), area: (a.detail.area as string | undefined) }));
  // One alert per service area (issue 198): Lakewood and Akron can get different snow.
  const areaOf = await areasFor(tenantId, sites);
  const proposals = groupDecisions(decisions, priorSends, recent, nowMs, (id) => areaOf.get(id) ?? 'Your area');
  const area = areaName(sites.map((s) => s.address));
  const created: string[] = [];
  for (const p of proposals) {
    const snapshotIds = sites.filter((s) => p.site_ids.includes(s.id)).map((s) => latest.get(siteCell(s))?.id).filter((v): v is string => Boolean(v));
    // More sites reaching a trigger while one is still waiting on someone: that alert grows, and people hear about it.
    // Only its own area's open alert grows; another area gets its own.
    const open = prior.find((a) => a.status === 'open' && a.kind === p.kind && ((a.detail.area as string | undefined) ?? null) === (p.area ?? null));
    if (open) {
      const merged = { ...p, site_ids: [...new Set([...(open.site_ids ?? []), ...p.site_ids])], sites: [...((open.detail.sites ?? []) as SiteDecision[]), ...p.sites] };
      const grown = alertHeadline(merged as typeof p, p.area ?? area, t.timezone);
      // Someone may have dispatched or dismissed it since it was read. Then it stays as they left it.
      const grew = await db.update(trigger_alert).set({ site_ids: merged.site_ids, snapshot_ids: [...new Set([...(open.snapshot_ids ?? []), ...snapshotIds])], detail: { ...open.detail, headline: grown, sites: merged.sites, evaluated_at: now.toISOString(), evaluated_at_local: fmtLocal(now, t.timezone) } })
        .where(and(eq(trigger_alert.id, open.id), eq(trigger_alert.status, 'open'))).returning({ id: trigger_alert.id });
      if (!grew.length) continue;
      created.push(open.id);
      await notifyOwners(t, open.id, grown, merged.site_ids.length);
      continue;
    }
    const headline = alertHeadline(p, p.area ?? area, t.timezone);
    const [row] = await db.insert(trigger_alert).values({
      tenant_id: tenantId,
      kind: p.kind,
      site_ids: p.site_ids,
      snapshot_ids: [...new Set(snapshotIds)],
      detail: { headline, sites: p.sites, ...(p.area ? { area: p.area } : {}), evaluated_at: now.toISOString(), evaluated_at_local: fmtLocal(now, t.timezone) },
    }).returning();
    created.push(row!.id);
    await notifyOwners(t, row!.id, headline);
  }
  return created;
}

function alertSummaries(doc: FetchedDoc): NwsAlert[] {
  return (doc.json.features ?? []).map((f: any) => ({ id: f.properties?.id ?? f.id, event: f.properties?.event, headline: f.properties?.headline ?? null, onset: f.properties?.onset ?? null, ends: f.properties?.ends ?? null }));
}

/** weather.fetch_alerts: active winter alerts at the tenant's service-area centroid. */
export async function fetchAlerts(tenantId: string) {
  const db = serviceDb();
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true)));
  if (!sites.length) return;
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  const { weather } = await getProviders();
  const now = await weatherNow();
  // At each service area's middle, not the company's (issue 198): the average of Lakewood and Akron is Brecksville,
  // which can miss a warning in either.
  const areaOf = await areasFor(tenantId, sites);
  const areas = [...new Set(areaOf.values())].sort();
  const prior = await db.select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, tenantId), eq(trigger_alert.kind, 'nws_alert')));
  const seen = prior.flatMap((a) => (a.detail.alert_ids ?? []) as string[]);
  for (const name of areas) {
    const mine = sites.filter((s) => areaOf.get(s.id) === name);
    const lat = mine.reduce((n, x) => n + x.lat, 0) / mine.length;
    const lon = mine.reduce((n, x) => n + x.lon, 0) / mine.length;
    let doc: FetchedDoc;
    try {
      doc = await weather.fetchAlerts(lat, lon, now);
      await recordSuccess();
    } catch (err) {
      await recordFailure();
      throw err;
    }
    const alerts = alertSummaries(doc);
    const { path, sha256 } = await archive('nws_alerts', `${lat.toFixed(2)},${lon.toFixed(2)}`, now, doc.raw);
    const snap = await insertSnapshot({ source: 'nws_alerts', fetchedAt: now, lastModified: doc.lastModified, url: doc.url, path, sha256, summary: { alerts, area: name, ...(doc.synthetic ? { synthetic: true } : {}) } });
    // One NWS warning often covers two areas: it alerts once, for the first.
    const fresh = newWinterAlerts(alerts, seen);
    if (!fresh.length) continue;
    seen.push(...fresh.map((a) => a.id));
    const headline = `${areas.length > 1 ? `${name}: ` : ''}${fresh[0]!.event}: ${fresh[0]!.headline ?? 'active for your service area'}`;
    const [row] = await db.insert(trigger_alert).values({
      tenant_id: tenantId, kind: 'nws_alert', site_ids: mine.map((s) => s.id), snapshot_ids: [snap.id],
      detail: { headline, area: name, alert_ids: fresh.map((a) => a.id), alerts: fresh, evaluated_at: now.toISOString() },
    }).returning();
    await notifyOwners(t!, row!.id, headline);
  }
}

/** weather.nohrsc: observed totals sampled at each active site. Evidence and billing only; too slow for dispatch. */
export async function fetchNohrsc(hours: 6 | 24 = 24) {
  const db = serviceDb();
  const sites = await db.select({ id: site.id, lat: site.lat, lon: site.lon }).from(site).where(eq(site.active, true));
  if (!sites.length) return null;
  const { weather } = await getProviders();
  const now = await weatherNow();
  const result = await weather.fetchNohrsc(hours, now, sites);
  if (!result) {
    log.info('nohrsc unavailable', { hours });
    return null;
  }
  const { path, sha256 } = await archive('nohrsc', `${hours}h`, now, result.raw, result.url.endsWith('.tif') ? 'tif' : 'json');
  return insertSnapshot({ source: 'nohrsc', fetchedAt: now, lastModified: result.lastModified, url: result.url, path, sha256, summary: { hours, valid_at: result.validAt, sites: result.samples, ...(result.synthetic ? { synthetic: true } : {}) } });
}

/** Latest forecast snapshot for each of a tenant's cells, plus latest alerts and NOHRSC, for attaching to a storm. */
export async function latestSnapshotIds(tenantId: string): Promise<string[]> {
  const db = serviceDb();
  const cells = await db.selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true), sql`${site.nws_office} is not null`));
  const ids = [...(await latestGrids(cells)).values()].map((s) => s.id);
  // Both accumulation windows: billing tiers read the 24 h total even when a 6 h file is newer.
  for (const hours of [6, 24]) {
    const [n] = await db.select({ id: weather_snapshot.id }).from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nohrsc'), sql`(${weather_snapshot.summary}->>'hours')::int = ${hours}`)).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    if (n) ids.push(n.id);
  }
  return ids;
}

/** Why there are no numbers, in words a dispatcher can act on (issue 45). */
const WHY = {
  breaker: 'NWS is not answering, so Flake paused weather for a few minutes. It tries again on its own.',
  not_mapped: 'These lots are not matched to an NWS forecast area yet. That happens a few minutes after a site is added with its address.',
  no_snapshot: 'No NWS forecast has been fetched for these lots yet. It updates every few minutes.',
  no_coverage: 'The National Weather Service has no forecast for these lots, which happens outside the US or for a pin in the wrong place. Check the address. Drivers can still report depth.',
} as const;

/** The dashboard header: the live forecast vs elapsed with source labels. Anything missing reads "unavailable", with why. */
export async function tenantWeatherHeader(tenantId: string, siteIds?: string[]) {
  const db = serviceDb();
  const [s] = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), siteIds?.length ? inArray(site.id, siteIds) : undefined, sql`${site.nws_office} is not null`)).limit(1);
  const breaker = await breakerState();
  const none = (why: keyof typeof WHY) => ({ forecast_in: null as number | null, elapsed_in: null as number | null, temp_f: null as number | null, source: 'unavailable', synthetic: false, fetched_at: null as string | null, breaker_open: breakerOpen(breaker), reason: (breakerOpen(breaker) ? WHY.breaker : WHY[why]) as string | null });
  if (!s) {
    const [checked] = await db.select({ id: site.id }).from(site).where(and(eq(site.tenant_id, tenantId), siteIds?.length ? inArray(site.id, siteIds) : undefined, sql`${site.nws_mapped_at} is not null`)).limit(1);
    return none(checked ? 'no_coverage' : 'not_mapped');
  }
  const [snap] = await db.select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, s.nws_office!), eq(weather_snapshot.grid_x, s.nws_grid_x!), eq(weather_snapshot.grid_y, s.nws_grid_y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
  if (!snap) return none('no_snapshot');
  const now = await weatherNow();
  const v = summarize(seriesFromSummary(snap.summary), now.getTime());
  return { forecast_in: v.snow_next12h_in, elapsed_in: v.snow_elapsed_in, temp_f: v.temp_f, source: snap.summary.synthetic ? 'Synthetic demo data' : 'NWS gridded forecast', synthetic: Boolean(snap.summary.synthetic), fetched_at: snap.fetched_at, breaker_open: breakerOpen(breaker), reason: null as string | null };
}

/**
 * The forecast by service area for the dashboard (issue 198): next 12 h, elapsed and temperature, and how many lots are
 * at or near their trigger. The snowiest area first. One row per area instead of one arbitrary lot's numbers.
 */
export async function areaWeather(tenantId: string) {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true)));
  if (!t || !sites.length) return [];
  const areaOf = await areasFor(tenantId, sites);
  const latest = await latestGrids(sites.map((s) => ({ office: s.nws_office, x: s.nws_grid_x, y: s.nws_grid_y })));
  const now = (await weatherNow()).getTime();
  const inputs = await triggerInputs(t, sites, now);
  const models = await latestModels(now);
  const rows = [...new Set(areaOf.values())].map((name) => {
    const mine = sites.filter((s) => areaOf.get(s.id) === name);
    const decided: SiteDecision[] = [];
    const ranges: [number, number][] = [];
    const radar: number[] = [];
    const sums = mine.map((s) => {
      const snap = latest.get(cellKey(s.nws_office, s.nws_grid_x, s.nws_grid_y));
      const w = snap ? lotWeather(snap.summary, models, s.id, now) : null;
      const v = w ? summarize(w.series, now) : null;
      const input = inputs.get(s.id);
      if (w && input) decided.push(...evaluateSite(input, w.series, now, [], { nbm: w.nbm }));
      if (w?.nbm) ranges.push([w.nbm.p10, w.nbm.p90]);
      if (w?.radar != null) radar.push(w.radar);
      return { v, trigger: input?.trigger_in ?? null };
    });
    const vals = (pick: (v: NonNullable<(typeof sums)[number]['v']>) => number | null) => sums.map((x) => (x.v ? pick(x.v) : null)).filter((x): x is number => x !== null);
    const next = vals((v) => v.snow_next12h_in);
    const elapsed = vals((v) => v.snow_elapsed_in);
    const temps = vals((v) => v.temp_f);
    const at = sums.filter((x) => x.trigger !== null && x.v?.snow_next12h_in != null && x.v.snow_next12h_in >= x.trigger).length;
    const near = sums.filter((x) => x.trigger !== null && x.v?.snow_next12h_in != null && x.v.snow_next12h_in < x.trigger && x.v.snow_next12h_in >= x.trigger * 0.75).length;
    // Plow vs salt vs no trigger, in words (issue 204): "0.5" + freezing rain, salt only".
    const line = triggerLine(decided);
    // The Blend's spread for the area (issue 203): its lowest 10th and highest 90th percentile, "1 to 4"".
    const range: [number, number] | null = ranges.length ? [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))] : null;
    return { area: name, lots: mine.length, forecast_in: next.length ? Math.max(...next) : null, elapsed_in: elapsed.length ? Math.max(...elapsed) : null, temp_f: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null, at_trigger: at, near_trigger: near, trigger: line, range_in: range, radar_1h_in: radar.length ? Math.max(...radar) : null };
  });
  return rows.sort((a, b) => (b.forecast_in ?? -1) - (a.forecast_in ?? -1) || a.area.localeCompare(b.area));
}

/** How far past the close an observed total may run and still count as the storm's snow. */
export const OBSERVED_SLACK_MS = 3 * HOUR;

/**
 * NOHRSC observed totals whose whole window falls inside the storm. The 24 h total fetched as a storm started is the
 * day before, and a 2 inch storm after a 6 inch one would otherwise read as 6.
 */
export async function observedSnapshots(start: number, end: number) {
  return (await serviceDb().select().from(weather_snapshot)
    .where(and(eq(weather_snapshot.source, 'nohrsc'), gte(weather_snapshot.fetched_at, new Date(start).toISOString()), lte(weather_snapshot.fetched_at, new Date(end + OBSERVED_SLACK_MS + 6 * HOUR).toISOString()))))
    .filter((x) => {
      const validAt = Date.parse(x.summary.valid_at ?? x.fetched_at);
      const hours = Number(x.summary.hours);
      return Number.isFinite(validAt) && hours > 0 && validAt - hours * HOUR >= start - HOUR && validAt <= end + OBSERVED_SLACK_MS;
    });
}

/**
 * The weather of one storm, not today's (issue 45): snow in the storm's own window from the NWS forecast (the most any
 * of its lots got), and NOHRSC observed snow when there is any. A closed storm reads only the snapshots attached to it
 * at start and close; while it runs, the newest forecast for its lots. Nothing captured says so instead of 0.
 */
export async function stormWeather(tenantId: string, s: { status: string; started_at: string; closed_at: string | null; forecast_snapshot_ids: string[] | null }, siteIds: string[]) {
  const db = serviceDb();
  const start = Date.parse(s.started_at);
  const active = s.status === 'active';
  const end = !active && s.closed_at ? Date.parse(s.closed_at) : (await weatherNow()).getTime();
  const sites = siteIds.length ? await db.select().from(site).where(and(eq(site.tenant_id, tenantId), inArray(site.id, siteIds))) : [];
  const cells = [...new Map(sites.filter((x) => x.nws_office).map((x) => [`${x.nws_office}/${x.nws_grid_x}/${x.nws_grid_y}`, x])).values()];
  let grids: (typeof weather_snapshot.$inferSelect)[] = [];
  if (active) {
    grids = [...(await latestGrids(cells.map((c) => ({ office: c.nws_office, x: c.nws_grid_x, y: c.nws_grid_y })))).values()];
  } else if (s.forecast_snapshot_ids?.length) {
    const attached = await db.select().from(weather_snapshot).where(and(inArray(weather_snapshot.id, s.forecast_snapshot_ids), eq(weather_snapshot.source, 'nws_grid'))).orderBy(desc(weather_snapshot.fetched_at));
    // The newest snapshot per forecast area: the one taken at close knows the most about the storm's hours.
    const newest = new Map<string, (typeof attached)[number]>();
    for (const g of attached) if (!newest.has(`${g.office}/${g.grid_x}/${g.grid_y}`)) newest.set(`${g.office}/${g.grid_x}/${g.grid_y}`, g);
    grids = [...newest.values()];
  }
  const totals = grids.map((g) => sumOverlap(seriesFromSummary(g.summary).snowIn, start, end)).filter((v): v is number => v !== null);
  const observed = (await observedSnapshots(start, end)).flatMap((x) => siteIds.map((id) => x.summary.sites?.[id])).filter((v): v is number => typeof v === 'number');
  const forecast_in = totals.length ? Math.max(...totals) : null;
  const observed_in = observed.length ? Math.max(...observed) : null;
  let note: string | null = null;
  if (forecast_in === null && observed_in === null) {
    if (!active) note = 'No weather was captured for this storm.';
    else if (breakerOpen(await breakerState())) note = WHY.breaker;
    else note = cells.length ? WHY.no_snapshot : WHY.not_mapped;
  }
  return { forecast_in, observed_in, synthetic: grids.some((g) => Boolean(g.summary.synthetic)), note };
}

/**
 * Observed weather at a lot's nearest airport station for a past window (issue 163): every report's temperature,
 * precipitation, weather codes and snow depth. Kept as a weather snapshot with its request URL and hash like the other
 * evidence. The same station and window reuse the saved snapshot, so a packet made again hashes the same.
 */
export async function stationHistory(station: string, from: string, to: string): Promise<typeof weather_snapshot.$inferSelect | null> {
  const db = serviceDb();
  const [saved] = await db.select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_obs'), eq(weather_snapshot.station, station), sql`${weather_snapshot.summary}->>'from' = ${from}`, sql`${weather_snapshot.summary}->>'to' = ${to}`)).limit(1);
  if (saved) return saved;
  const { weather } = await getProviders();
  const got = await weather.fetchStationHistory(station, new Date(from), new Date(to));
  if (!got) return null;
  const now = new Date();
  const { path, sha256 } = await archive('station', station, now, got.raw, got.url.includes('format=onlycomma') ? 'csv' : 'json');
  return insertSnapshot({ source: 'nws_obs', station, fetchedAt: now, lastModified: null, url: got.url, path, sha256, summary: { kind: 'history', from, to, provider: got.provider, rows: got.rows, ...(got.synthetic ? { synthetic: true } : {}) } });
}
