import { distanceMeters } from './geo';
import { cityOf } from './address';

/** One hour of a gridded series. v === null means unavailable, never zero. */
export interface HourBucket {
  t: number;
  v: number | null;
}

export interface NwsValue {
  validTime: string;
  value: number | null;
}

const HOUR = 3600 * 1000;
export const DEPTH_REPORT_RADIUS_M = 5000;
export const DEBOUNCE_MS = 30 * 60 * 1000;
const EVENT_END_ZERO_HOURS = 6;

/** Converts a layer's unit of measure to inches ("wmoUnit:mm", usually). */
export function toInches(value: number, uom: string | null | undefined): number {
  const unit = (uom ?? 'wmoUnit:mm').split(':').pop();
  if (unit === 'cm') return value / 2.54;
  if (unit === 'm') return value * 39.3701;
  if (unit === 'in') return value;
  return value / 25.4;
}

export function toFahrenheit(value: number, uom: string | null | undefined): number {
  return (uom ?? '').endsWith('degF') ? value : (value * 9) / 5 + 32;
}

/** Parses ISO-8601 durations of the shape NWS emits, like PT6H or P1DT6H. */
export function durationHours(duration: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
  if (!m) throw new Error(`Unsupported duration: ${duration}`);
  return Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60;
}

/** Expands validTime = start/duration intervals to hourly buckets, pro-rated evenly when `prorate`. */
export function expandSeries(values: NwsValue[], convert: (v: number) => number, prorate = true): HourBucket[] {
  const out: HourBucket[] = [];
  for (const { validTime, value } of values) {
    const [start, dur] = validTime.split('/') as [string, string];
    const hours = Math.max(1, Math.round(durationHours(dur)));
    const t0 = Date.parse(start);
    for (let i = 0; i < hours; i++) {
      out.push({ t: t0 + i * HOUR, v: value === null ? null : prorate ? convert(value) / hours : convert(value) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sum over [from, to). null if every bucket in the range is unavailable or there are none. */
export function sumRange(buckets: HourBucket[], from: number, to: number): number | null {
  const known = buckets.filter((b) => b.t >= from && b.t < to && b.v !== null);
  return known.length ? round1(known.reduce((s, b) => s + b.v!, 0)) : null;
}

/**
 * Sum over [from, to), with each hourly bucket counted for the part of its hour inside the range. A storm that starts
 * at 9:40 gets a third of the 9:00 hour and none of the hour after it closes.
 */
export function sumOverlap(buckets: HourBucket[], from: number, to: number): number | null {
  let total = 0;
  let any = false;
  for (const b of buckets) {
    if (b.v === null) continue;
    const inside = Math.min(b.t + HOUR, to) - Math.max(b.t, from);
    if (inside <= 0) continue;
    any = true;
    total += (b.v * inside) / HOUR;
  }
  return any ? round1(total) : null;
}

/** First hour with snow in the event active at `at`; the event ends after 6 h of zero. Null hours don't count. */
export function findOnset(buckets: HourBucket[], at: number): number | null {
  let onset: number | null = null;
  let zeros = 0;
  for (const b of buckets) {
    if (b.t > at || b.v === null) continue;
    if (b.v > 0) {
      onset ??= b.t;
      zeros = 0;
    } else if (onset !== null && ++zeros >= EVENT_END_ZERO_HOURS) {
      onset = null;
    }
  }
  return onset;
}

export interface WeatherSeries {
  snowIn: HourBucket[];
  iceIn: HourBucket[];
  tempF: HourBucket[];
}

export interface SummaryValues {
  snow_next12h_in: number | null;
  snow_elapsed_in: number | null;
  temp_f: number | null;
}

export function summarize(series: WeatherSeries, now: number): SummaryValues {
  const onset = findOnset(series.snowIn, now);
  const temp = [...series.tempF].reverse().find((b) => b.t <= now && b.v !== null);
  return {
    snow_next12h_in: sumRange(series.snowIn, now, now + 12 * HOUR),
    snow_elapsed_in: onset === null ? 0 : sumRange(series.snowIn, onset, now + 1),
    temp_f: temp ? Math.round(temp.v!) : null,
  };
}

export interface TriggerSite {
  site_id: string;
  lat: number;
  lon: number;
  trigger_in: number | null;
  has_salt: boolean;
  /** When a salt lot gets a salt run (issue 204). Missing means the company default. */
  salt?: SaltTrigger | null;
  /** Snow is still down: a storm in the last 3 days. The forecast's own 48 h of history counts too. */
  snow_on_ground?: boolean;
}

export interface DepthReport {
  lat: number;
  lon: number;
  depth_in: number;
  at: number;
}

/**
 * When a lot with salt in its contract needs a salt run (issue 204): snow at or over `snow_in` (0 = any measurable
 * snow, null = never on snow alone), freezing rain or ice, and melt then refreeze. Air temperature drives refreeze; no
 * free feed gives pavement temperature across the US.
 */
export interface SaltTrigger { snow_in: number | null; ice: boolean; refreeze: boolean }
export const DEFAULT_SALT_TRIGGER: SaltTrigger = { snow_in: 0, ice: true, refreeze: true };

/** `refreeze` is the old name for a salt run on ice or melt; nothing new is written with it. */
export type AlertKind = 'forecast' | 'depth_report' | 'refreeze' | 'salt_run' | 'nws_alert';
export type SaltReason = 'snow' | 'ice' | 'melt';

export interface SiteDecision {
  kind: 'forecast' | 'depth_report' | 'refreeze' | 'salt_run';
  site_id: string;
  event_key: string;
  value_in: number | null;
  at_iso?: string;
  label?: string;
  /** For a refreeze: the low after the freeze, and the high before it. */
  low_f?: number | null;
  high_f?: number | null;
  reason?: 'ice' | 'melt';
  /** A salt run's conditions, snow first. */
  reasons?: SaltReason[];
  /** A plow decision on a lot that also has salt: "plow + salt". */
  salt?: boolean;
  /** How sure the Blend of models is that the trigger is reached (issue 203). Absent when there's no Blend run. */
  confidence?: Confidence;
  /** The Blend's 10th to 90th percentile snowfall for the next 12 hours, for "1 to 4"". */
  range_in?: [number, number];
}

/**
 * Issue 203. certain: 9 in 10 model outcomes reach the trigger (the 10th percentile does). likely: at least half do.
 * possible: fewer than half, though the NWS forecast does.
 */
export type Confidence = 'certain' | 'likely' | 'possible';
export interface Percentiles { p10: number; p50: number; p90: number }

export function confidenceOf(p: Percentiles, trigger: number): Confidence {
  if (p.p10 >= trigger) return 'certain';
  if (p.p50 >= trigger) return 'likely';
  return 'possible';
}

/**
 * The Blend's percentiles over [from, to) from its 6-hour windows, each counted for the part inside. Adding percentiles
 * window by window is an approximation (it assumes the windows move together), close enough for "how sure". Null
 * when no window with values covers the range.
 */
export function percentilesOver(windows: { start: string; end: string }[], values: { p10: (number | null)[]; p50: (number | null)[]; p90: (number | null)[] }, from: number, to: number): Percentiles | null {
  const out = { p10: 0, p50: 0, p90: 0 };
  let covered = 0;
  windows.forEach((w, i) => {
    const s = Date.parse(w.start);
    const e = Date.parse(w.end);
    const inside = Math.min(e, to) - Math.max(s, from);
    if (inside <= 0) return;
    const a = values.p10[i], b = values.p50[i], c = values.p90[i];
    if (a == null || b == null || c == null) return;
    const share = inside / (e - s);
    out.p10 += a * share;
    out.p50 += b * share;
    out.p90 += c * share;
    covered += inside;
  });
  if (covered < (to - from) / 2) return null;
  return { p10: round1(out.p10), p50: round1(out.p50), p90: round1(out.p90) };
}

/**
 * During a storm the hourly HRRR run is more accurate for the next few hours than the NWS grid, which is updated less
 * often. Its hours replace the grid's; hours it doesn't cover, or has no value for, keep the grid's (issue 203).
 */
export function blendNowcast(series: WeatherSeries, nowcast: { hours: string[]; snow: (number | null)[]; ice: (number | null)[] } | null | undefined): WeatherSeries {
  if (!nowcast) return series;
  const swap = (buckets: HourBucket[], vals: (number | null)[]) => {
    const by = new Map(buckets.map((b) => [b.t, b]));
    nowcast.hours.forEach((h, i) => {
      const v = vals[i];
      if (v === null || v === undefined) return;
      by.set(Date.parse(h), { t: Date.parse(h), v });
    });
    return [...by.values()].sort((a, b) => a.t - b.t);
  };
  return { ...series, snowIn: swap(series.snowIn, nowcast.snow), iceIn: swap(series.iceIn, nowcast.ice) };
}

/** When the running forecast total first reaches the trigger, for "2.4" by 5 AM". */
export function reachesTriggerAt(buckets: HourBucket[], from: number, to: number, trigger: number): number | null {
  let sum = 0;
  for (const b of buckets) {
    if (b.t < from || b.t >= to || b.v === null) continue;
    sum += b.v;
    if (sum >= trigger) return b.t + HOUR;
  }
  return null;
}

export interface Refreeze { at: number; reason: 'ice' | 'melt'; low_f: number | null; high_f: number | null }

/**
 * When salted pavement is about to ice over: freezing rain or drizzle in the next 12 hours, or snow still on the ground
 * that melts above 32 F and then freezes again within 18 hours (the night after a sunny day). Works the same anywhere
 * the NWS forecasts; nothing here is tuned to one region.
 */
export function refreezeForecast(series: WeatherSeries, now: number, snowOnGround = false, watch: { ice?: boolean; melt?: boolean } = {}): Refreeze | null {
  const ice = watch.ice === false ? undefined : series.iceIn.filter((b) => b.t >= now && b.t < now + 12 * HOUR && (b.v ?? 0) > 0).sort((a, b) => a.t - b.t)[0];
  const temps = series.tempF.filter((b) => b.v !== null).sort((a, b) => a.t - b.t);
  const lowAfter = (t: number) => {
    const next = temps.filter((b) => b.t >= t && b.t < t + 12 * HOUR).map((b) => b.v!);
    return next.length ? Math.min(...next) : null;
  };
  if (ice) return { at: ice.t, reason: 'ice', low_f: lowAfter(ice.t), high_f: null };
  if (watch.melt === false) return null;
  const recentSnow = sumRange(series.snowIn, now - 48 * HOUR, now + 6 * HOUR);
  if (!snowOnGround && !(recentSnow !== null && recentSnow > 0)) return null;
  const window = temps.filter((b) => b.t >= now - 12 * HOUR && b.t < now + 18 * HOUR);
  for (let i = 1; i < window.length; i++) {
    const b = window[i]!;
    if (b.t < now || !(window[i - 1]!.v! > 32 && b.v! <= 32)) continue;
    const before = window.slice(0, i).map((x) => x.v!);
    return { at: b.t, reason: 'melt', low_f: lowAfter(b.t), high_f: Math.max(...before) };
  }
  return null;
}

/** The smallest snowfall the weather service reports. */
export const ANY_SNOW_IN = 0.1;

/** ADDENDUM_WEATHER section 3 for one site. Never dispatches anything; the owner still taps Start storm. */
export function evaluateSite(site: TriggerSite, series: WeatherSeries, now: number, reports: DepthReport[], blend: { nbm?: Percentiles | null } = {}): SiteDecision[] {
  const out: SiteDecision[] = [];
  const onset = findOnset(series.snowIn, now);
  const eventT = onset ?? findOnset(series.snowIn, now + 12 * HOUR);
  const eventKey = eventT === null ? `quiet:${new Date(now).toISOString().slice(0, 10)}` : new Date(eventT).toISOString();

  if (site.trigger_in !== null) {
    // A 0" trigger is a zero tolerance contract: any measurable snow, not every dry day.
    const trigger = Math.max(site.trigger_in, ANY_SNOW_IN);
    const next12 = sumRange(series.snowIn, now, now + 12 * HOUR);
    const nbm = blend.nbm ?? null;
    // The forecast reaches the trigger, or else half the Blend's outcomes do (issue 203): one source missing a storm
    // the others see still alerts, marked "likely".
    const byForecast = next12 !== null && next12 >= trigger;
    if (byForecast || (nbm && nbm.p50 >= trigger)) {
      const at = byForecast ? reachesTriggerAt(series.snowIn, now, now + 12 * HOUR, trigger) : null;
      out.push({
        kind: 'forecast',
        site_id: site.site_id,
        event_key: eventKey,
        value_in: byForecast ? next12 : nbm!.p50,
        ...(nbm ? { confidence: confidenceOf(nbm, trigger), range_in: [nbm.p10, nbm.p90] as [number, number] } : {}),
        ...(at !== null ? { at_iso: new Date(at).toISOString() } : {}),
        ...(site.has_salt ? { salt: true } : {}),
      });
    }
    const elapsed = onset === null ? null : sumRange(series.snowIn, onset, now + 1);
    const since = onset ?? now - 12 * HOUR;
    const nearby = reports
      .filter((r) => r.at >= since && r.at <= now && distanceMeters(r.lat, r.lon, site.lat, site.lon) <= DEPTH_REPORT_RADIUS_M)
      .sort((a, b) => b.at - a.at)[0];
    const known = [elapsed, nearby ? nearby.depth_in : null].filter((v): v is number => v !== null);
    if (known.length && Math.max(...known) >= trigger) {
      out.push({ kind: 'depth_report', site_id: site.site_id, event_key: eventKey, value_in: Math.max(...known), ...(site.has_salt ? { salt: true } : {}) });
    }
  }
  const salt = saltRun(site, series, now, eventKey, out.length > 0);
  if (salt) out.push(salt);
  return out;
}

/**
 * One salt run decision for a salt lot (issue 204), folding snow under the plow trigger, freezing rain and refreeze
 * into one, so a lot never gets two salt alerts for the same night. Snow that already put the lot on a plow alert isn't
 * repeated here: that alert says "plow + salt". Freezing rain or a refreeze still is, since the plow alert doesn't
 * cover it.
 */
function saltRun(site: TriggerSite, series: WeatherSeries, now: number, eventKey: string, plowing: boolean): SiteDecision | null {
  if (!site.has_salt) return null;
  const rule = site.salt ?? DEFAULT_SALT_TRIGGER;
  const reasons: SaltReason[] = [];
  let value: number | null = null;
  let at: number | null = null;
  if (rule.snow_in !== null && !plowing) {
    const need = Math.max(rule.snow_in, ANY_SNOW_IN);
    const next12 = sumRange(series.snowIn, now, now + 12 * HOUR);
    if (next12 !== null && next12 >= need) {
      reasons.push('snow');
      value = next12;
      at = reachesTriggerAt(series.snowIn, now, now + 12 * HOUR, need);
    }
  }
  const freeze = rule.ice || rule.refreeze ? refreezeForecast(series, now, site.snow_on_ground, { ice: rule.ice, melt: rule.refreeze }) : null;
  if (freeze) {
    reasons.push(freeze.reason);
    at = at === null ? freeze.at : Math.min(at, freeze.at);
  }
  if (!reasons.length) return null;
  // Snow keys on the storm, like a plow alert. Ice and refreeze key on the day, so tonight's freeze alerts once
  // however often it's checked.
  const key = reasons[0] === 'snow' ? `salt:${eventKey}` : `refreeze:${new Date(freeze!.at).toISOString().slice(0, 10)}`;
  return {
    kind: 'salt_run', site_id: site.site_id, event_key: key, value_in: value, reasons,
    ...(at !== null ? { at_iso: new Date(at).toISOString() } : {}),
    ...(freeze ? { low_f: freeze.low_f, high_f: freeze.high_f, reason: freeze.reason } : {}),
  };
}

/** What a set of decisions means for a service area, in words (issue 204): `3" forecast, plow + salt`, `salt only`. */
export function triggerLine(decisions: SiteDecision[]): { plow: boolean; salt: boolean; text: string } {
  const plowing = decisions.filter((d) => d.kind === 'forecast' || d.kind === 'depth_report');
  const salting = decisions.filter((d) => d.kind === 'salt_run' || d.kind === 'refreeze');
  if (plowing.length) {
    const v = plowing.map((d) => d.value_in).filter((x): x is number => x !== null);
    const sure = alertConfidence(plowing);
    const head = v.length ? `${Math.max(...v)}" ${plowing.some((d) => d.kind === 'forecast') ? `forecast${sure ? ` (${sure})` : ''}` : 'down'}` : 'At trigger';
    const extra = salting.some((d) => d.reasons?.includes('ice') || d.reason === 'ice') ? ' + freezing rain' : '';
    const withSalt = plowing.some((d) => d.salt) || salting.length > 0;
    return { plow: true, salt: withSalt, text: `${head}${extra}, ${withSalt ? 'plow + salt' : 'plow'}` };
  }
  if (salting.length) {
    const what = saltConditions(salting);
    return { plow: false, salt: true, text: `${what[0]!.toUpperCase()}${what.slice(1)}, salt only` };
  }
  return { plow: false, salt: false, text: 'No trigger' };
}

/** `0.5" + freezing rain`, `refreeze`: what a salt run is for. */
function saltConditions(ds: SiteDecision[]): string {
  const has = (r: SaltReason) => ds.some((d) => d.reasons?.includes(r) || (r !== 'snow' && d.reason === r));
  const snow = ds.filter((d) => d.reasons?.includes('snow')).map((d) => d.value_in).filter((x): x is number => x !== null);
  const parts = [snow.length ? `${Math.max(...snow)}"` : null, has('ice') ? 'freezing rain' : null, has('melt') ? 'refreeze' : null].filter(Boolean);
  return parts.join(' + ') || 'salt conditions';
}

export interface PriorSend {
  kind: AlertKind;
  site_id: string;
  event_key: string;
}

export interface ProposedAlert {
  kind: 'forecast' | 'depth_report' | 'refreeze' | 'salt_run';
  site_ids: string[];
  sites: SiteDecision[];
  /** The service area these lots are in (issue 198): Lakewood and Akron get their own alerts. */
  area?: string;
}

/** A lot's service area: the owner's name for it, or else the city in its address. */
export function serviceArea(address: string, override?: string | null): string {
  const named = override?.trim();
  if (named) return named;
  return cityOf(address) || 'Your area';
}

/**
 * Groups decisions into one alert per kind for the tenant. A site fires once per event per kind.
 * A kind that alerted under 30 minutes ago waits; unsent sites are simply re-proposed on the next poll.
 */
export function groupDecisions(
  decisions: SiteDecision[],
  prior: PriorSend[],
  recent: { kind: AlertKind; created_at: number; area?: string }[],
  now: number,
  areaOf?: (siteId: string) => string,
): ProposedAlert[] {
  const sent = new Set(prior.map((p) => `${p.kind}|${p.site_id}|${p.event_key}`));
  const fresh = decisions.filter((d) => !sent.has(`${d.kind}|${d.site_id}|${d.event_key}`));
  const out: ProposedAlert[] = [];
  // One alert per kind and service area (issue 198). Without areas, everything is one area, as before.
  const areas = areaOf ? [...new Set(fresh.map((d) => areaOf(d.site_id)))].sort() : [undefined];
  for (const kind of ['forecast', 'depth_report', 'salt_run', 'refreeze'] as const) {
    for (const area of areas) {
      const sites = fresh.filter((d) => d.kind === kind && (area === undefined || areaOf!(d.site_id) === area));
      if (!sites.length) continue;
      if (recent.some((r) => r.kind === kind && (area === undefined || r.area === undefined || r.area === area) && now - r.created_at < DEBOUNCE_MS)) continue;
      out.push({ kind, site_ids: [...new Set(sites.map((s) => s.site_id))], sites, ...(area !== undefined ? { area } : {}) });
    }
  }
  return out;
}

const WINTER_EVENTS = new Set([
  'Winter Storm Warning',
  'Winter Storm Watch',
  'Winter Weather Advisory',
  'Lake Effect Snow Warning',
  'Lake Effect Snow Advisory',
  'Lake Effect Snow Watch',
  'Blizzard Warning',
  'Ice Storm Warning',
  'Snow Squall Warning',
  'Freezing Rain Advisory',
  // Black ice from fog that freezes on pavement: a salt run, anywhere in the country.
  'Freezing Fog Advisory',
  'Blizzard Watch',
]);

export interface NwsAlert {
  id: string;
  event: string;
  headline?: string | null;
  onset?: string | null;
  ends?: string | null;
}

export function newWinterAlerts(alerts: NwsAlert[], seenIds: string[]): NwsAlert[] {
  return alerts.filter((a) => WINTER_EVENTS.has(a.event) && !seenIds.includes(a.id));
}

/** An alert is as sure as its least sure lot (issue 203). Undefined when no lot had a Blend run to go by. */
export function alertConfidence(sites: SiteDecision[]): Confidence | undefined {
  const order: Confidence[] = ['possible', 'likely', 'certain'];
  const known = sites.map((s) => s.confidence).filter((c): c is Confidence => Boolean(c));
  return known.length ? order[Math.min(...known.map((c) => order.indexOf(c)))] : undefined;
}

/** ", plow + salt" when every lot on a plow alert also gets salt, ", plow, 4 with salt" when some do, else ", plow". */
function withSalt(alert: ProposedAlert): string {
  const salted = new Set(alert.sites.filter((s) => s.salt).map((s) => s.site_id)).size;
  if (!salted) return ', plow';
  return salted === alert.site_ids.length ? ', plow + salt' : `, plow, ${salted} with salt`;
}

/** e.g. `Lakewood: 2.4" forecast by 5 AM, 18 sites at trigger, plow + salt.` */
export function alertHeadline(alert: ProposedAlert, area: string, tz: string): string {
  const n = alert.site_ids.length;
  const sites = `${n} site${n === 1 ? '' : 's'}`;
  if (alert.kind === 'salt_run') {
    const first = alert.sites.map((s) => s.at_iso).filter((v): v is string => Boolean(v)).sort()[0];
    const time = first ? ` by ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(first))} ${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(first))}` : '';
    const lows = alert.sites.filter((s) => s.reasons?.includes('melt')).map((s) => s.low_f).filter((v): v is number => typeof v === 'number');
    const low = lows.length ? `, down to ${Math.round(Math.min(...lows))}°F` : '';
    return `${area}: ${saltConditions(alert.sites)}${time}${low}, salt only. ${n} salt lot${n === 1 ? '' : 's'}.`;
  }
  if (alert.kind === 'refreeze') {
    const first = alert.sites.map((s) => s.at_iso).filter((v): v is string => Boolean(v)).sort()[0];
    // Day and hour formatted apart and joined here: one formatter's punctuation between them differs across platforms.
    const time = first ? `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(first))} ${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(first))}` : null;
    const lows = alert.sites.map((s) => s.low_f).filter((v): v is number => typeof v === 'number');
    const salt = `${n} salt lot${n === 1 ? '' : 's'}`;
    if (alert.sites.some((s) => s.reason === 'ice')) return `${area}: freezing rain expected${time ? ` by ${time}` : ''} at ${salt}.`;
    return `${area}: refreeze risk at ${salt}. Melting now, below freezing${time ? ` by ${time}` : ''}${lows.length ? `, down to ${Math.round(Math.min(...lows))}°F` : ''}.`;
  }
  const values = alert.sites.map((s) => s.value_in).filter((v): v is number => v !== null);
  if (!values.length) return `${area}: refreeze risk at ${sites}.`;
  const max = Math.max(...values);
  if (alert.kind === 'depth_report') return `${area}: ${max}" reported or elapsed, ${sites} at trigger now${withSalt(alert)}.`;
  const at = alert.sites.map((s) => s.at_iso).filter((v): v is string => Boolean(v)).sort()[0];
  const by = at ? ` by ${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(at))}` : ' in the next 12 h';
  const sure = alertConfidence(alert.sites);
  return `${area}: ${max}" forecast${sure ? ` (${sure})` : ''}${by}, ${sites} at trigger${withSalt(alert)}.`;
}
