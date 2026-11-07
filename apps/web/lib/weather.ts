import { gzipSync } from 'node:zlib';
import { and, app_setting, contract, desc, driver_action, eq, gte, inArray, serviceDb, site, sql, tenant, trigger_alert, weather_snapshot } from '@flake/db';
import { expandSeries, evaluateSite, groupDecisions, alertHeadline, newWinterAlerts, summarize, toFahrenheit, toInches, type DepthReport, type HourBucket, type NwsAlert, type SiteDecision, type TriggerSite, type WeatherSeries } from '@flake/core/trigger';
import type { ContractService } from '@flake/core/pricing';
import { fmtLocal } from '@flake/core/time';
import type { FetchedDoc } from '@flake/providers';
import { putBlob } from './blob';
import { baseUrl } from './env';
import { enqueue } from './jobs';
import { log } from './log';
import { notifyOffice } from './messaging';
import { getProviders, getSetting, setSetting, weatherNow } from './providers';
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
  for (const c of cells) {
    const [last] = await serviceDb().select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, c.office!), eq(weather_snapshot.grid_x, c.x!), eq(weather_snapshot.grid_y, c.y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    const age = last ? Date.now() - Date.parse(last.fetched_at) : Infinity;
    const busy = last ? Boolean(last.summary.alerts?.length) || (summarize(seriesFromSummary(last.summary), now.getTime() + 12 * HOUR).snow_next12h_in ?? 0) > 0 || (summarize(seriesFromSummary(last.summary), now.getTime()).snow_next12h_in ?? 0) > 0 : true;
    if (age > 60 * 60000 || (busy && age > 15 * 60000)) {
      await enqueue('weather.fetch_cell', { office: c.office, x: c.x, y: c.y }, { dedupeKey: `cell:${c.office}:${c.x}:${c.y}:${Math.floor(Date.now() / (15 * 60000))}` });
      queued++;
    }
  }
  const tenants = await serviceDb().selectDistinct({ id: site.tenant_id }).from(site).where(eq(site.active, true));
  for (const t of tenants) await enqueue('weather.fetch_alerts', { tenantId: t.id }, { dedupeKey: `alerts:${t.id}:${Math.floor(Date.now() / (15 * 60000))}` });
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
    const city = a.split(',')[1]?.trim();
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Your area';
};

async function notifyOwners(t: typeof tenant.$inferSelect, alertId: string, headline: string) {
  const link = `${baseUrl()}/alerts/${alertId}`;
  const related = { alert_id: alertId };
  return notifyOffice(t, { headline, link, key: `alert:${alertId}`, related });
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
  const contracts = await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at));
  const cellKey = (s: { nws_office: string | null; nws_grid_x: number | null; nws_grid_y: number | null }) => `${s.nws_office}/${s.nws_grid_x}/${s.nws_grid_y}`;
  const latest = new Map<string, typeof weather_snapshot.$inferSelect>();
  for (const s of sites) {
    const key = cellKey(s);
    if (latest.has(key)) continue;
    const [snap] = await db.select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, s.nws_office!), eq(weather_snapshot.grid_x, s.nws_grid_x!), eq(weather_snapshot.grid_y, s.nws_grid_y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    if (snap) latest.set(key, snap);
  }
  const depthRows = await db.select().from(driver_action).where(and(eq(driver_action.tenant_id, tenantId), eq(driver_action.kind, 'depth'), gte(driver_action.device_at, new Date(nowMs - 48 * HOUR).toISOString())));
  const reports: DepthReport[] = depthRows
    .filter((r) => typeof r.payload.lat === 'number')
    .map((r) => ({ lat: r.payload.lat, lon: r.payload.lon, depth_in: r.payload.depth_in, at: Date.parse(r.device_at) }));

  const decisions: SiteDecision[] = [];
  for (const s of sites) {
    const c = contracts.find((x) => x.site_id === s.id);
    const services = (c?.services ?? []) as ContractService[];
    const triggers = services.map((x) => x.trigger_in).filter((v): v is number => typeof v === 'number');
    const input: TriggerSite = { site_id: s.id, lat: s.lat, lon: s.lon, trigger_in: triggers.length ? Math.min(...triggers) : null, has_salt: services.some((x) => x.service === 'salt') };
    if (input.trigger_in === null && !input.has_salt) continue;
    const snap = latest.get(cellKey(s));
    if (snap) decisions.push(...evaluateSite(input, seriesFromSummary(snap.summary), nowMs, reports));
  }
  const prior = await db.select().from(trigger_alert).where(eq(trigger_alert.tenant_id, tenantId));
  const priorSends = prior.flatMap((a) => ((a.detail.sites ?? []) as SiteDecision[]).map((d) => ({ kind: a.kind!, site_id: d.site_id, event_key: d.event_key })));
  // Debounce on the evaluation clock so the demo's fake clock behaves like real time.
  const recent = prior.map((a) => ({ kind: a.kind!, created_at: a.detail.evaluated_at ? Date.parse(a.detail.evaluated_at) : Date.parse(a.created_at!) }));
  const proposals = groupDecisions(decisions, priorSends, recent, nowMs);
  const area = areaName(sites.map((s) => s.address));
  const created: string[] = [];
  for (const p of proposals) {
    const headline = alertHeadline(p, area, t.timezone);
    const snapshotIds = sites.filter((s) => p.site_ids.includes(s.id)).map((s) => latest.get(cellKey(s))?.id).filter((v): v is string => Boolean(v));
    const [row] = await db.insert(trigger_alert).values({
      tenant_id: tenantId,
      kind: p.kind,
      site_ids: p.site_ids,
      snapshot_ids: [...new Set(snapshotIds)],
      detail: { headline, sites: p.sites, evaluated_at: now.toISOString(), evaluated_at_local: fmtLocal(now, t.timezone) },
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
  const lat = sites.reduce((s, x) => s + x.lat, 0) / sites.length;
  const lon = sites.reduce((s, x) => s + x.lon, 0) / sites.length;
  const { weather } = await getProviders();
  const now = await weatherNow();
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
  const snap = await insertSnapshot({ source: 'nws_alerts', fetchedAt: now, lastModified: doc.lastModified, url: doc.url, path, sha256, summary: { alerts, ...(doc.synthetic ? { synthetic: true } : {}) } });
  const prior = await db.select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, tenantId), eq(trigger_alert.kind, 'nws_alert')));
  const fresh = newWinterAlerts(alerts, prior.flatMap((a) => (a.detail.alert_ids ?? []) as string[]));
  if (!fresh.length) return;
  const headline = `${fresh[0]!.event}: ${fresh[0]!.headline ?? 'active for your service area'}`;
  const [row] = await db.insert(trigger_alert).values({
    tenant_id: tenantId, kind: 'nws_alert', site_ids: sites.map((s) => s.id), snapshot_ids: [snap.id],
    detail: { headline, alert_ids: fresh.map((a) => a.id), alerts: fresh, evaluated_at: now.toISOString() },
  }).returning();
  await notifyOwners(t!, row!.id, headline);
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
  const ids: string[] = [];
  for (const c of cells) {
    const [s] = await db.select({ id: weather_snapshot.id }).from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, c.office!), eq(weather_snapshot.grid_x, c.x!), eq(weather_snapshot.grid_y, c.y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    if (s) ids.push(s.id);
  }
  // Both accumulation windows: billing tiers read the 24 h total even when a 6 h file is newer.
  for (const hours of [6, 24]) {
    const [n] = await db.select({ id: weather_snapshot.id }).from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nohrsc'), sql`(${weather_snapshot.summary}->>'hours')::int = ${hours}`)).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    if (n) ids.push(n.id);
  }
  return ids;
}

/** The dashboard header: forecast vs elapsed with source labels. Anything missing reads "unavailable". */
export async function tenantWeatherHeader(tenantId: string, siteIds?: string[]) {
  const db = serviceDb();
  const [s] = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), siteIds?.length ? inArray(site.id, siteIds) : undefined, sql`${site.nws_office} is not null`)).limit(1);
  const breaker = await breakerState();
  const none = { forecast_in: null as number | null, elapsed_in: null as number | null, temp_f: null as number | null, source: 'unavailable', synthetic: false, fetched_at: null as string | null, breaker_open: breakerOpen(breaker) };
  if (!s) return none;
  const [snap] = await db.select().from(weather_snapshot).where(and(eq(weather_snapshot.source, 'nws_grid'), eq(weather_snapshot.office, s.nws_office!), eq(weather_snapshot.grid_x, s.nws_grid_x!), eq(weather_snapshot.grid_y, s.nws_grid_y!))).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
  if (!snap) return none;
  const now = await weatherNow();
  const v = summarize(seriesFromSummary(snap.summary), now.getTime());
  return { forecast_in: v.snow_next12h_in, elapsed_in: v.snow_elapsed_in, temp_f: v.temp_f, source: snap.summary.synthetic ? 'Synthetic demo data' : 'NWS gridded forecast', synthetic: Boolean(snap.summary.synthetic), fetched_at: snap.fetched_at, breaker_open: breakerOpen(breaker) };
}
