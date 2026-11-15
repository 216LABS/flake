import { distanceMeters } from './geo';

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
  /** Snow is still down: a storm in the last 3 days. The forecast's own 48 h of history counts too. */
  snow_on_ground?: boolean;
}

export interface DepthReport {
  lat: number;
  lon: number;
  depth_in: number;
  at: number;
}

export type AlertKind = 'forecast' | 'depth_report' | 'refreeze' | 'nws_alert';

export interface SiteDecision {
  kind: 'forecast' | 'depth_report' | 'refreeze';
  site_id: string;
  event_key: string;
  value_in: number | null;
  at_iso?: string;
  label?: string;
  /** For a refreeze: the low after the freeze, and the high before it. */
  low_f?: number | null;
  high_f?: number | null;
  reason?: 'ice' | 'melt';
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
export function refreezeForecast(series: WeatherSeries, now: number, snowOnGround = false): Refreeze | null {
  const ice = series.iceIn.filter((b) => b.t >= now && b.t < now + 12 * HOUR && (b.v ?? 0) > 0).sort((a, b) => a.t - b.t)[0];
  const temps = series.tempF.filter((b) => b.v !== null).sort((a, b) => a.t - b.t);
  const lowAfter = (t: number) => {
    const next = temps.filter((b) => b.t >= t && b.t < t + 12 * HOUR).map((b) => b.v!);
    return next.length ? Math.min(...next) : null;
  };
  if (ice) return { at: ice.t, reason: 'ice', low_f: lowAfter(ice.t), high_f: null };
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
export function evaluateSite(site: TriggerSite, series: WeatherSeries, now: number, reports: DepthReport[]): SiteDecision[] {
  const out: SiteDecision[] = [];
  const onset = findOnset(series.snowIn, now);
  const eventT = onset ?? findOnset(series.snowIn, now + 12 * HOUR);
  const eventKey = eventT === null ? `quiet:${new Date(now).toISOString().slice(0, 10)}` : new Date(eventT).toISOString();

  if (site.trigger_in !== null) {
    // A 0" trigger is a zero tolerance contract: any measurable snow, not every dry day.
    const trigger = Math.max(site.trigger_in, ANY_SNOW_IN);
    const next12 = sumRange(series.snowIn, now, now + 12 * HOUR);
    if (next12 !== null && next12 >= trigger) {
      const at = reachesTriggerAt(series.snowIn, now, now + 12 * HOUR, trigger);
      out.push({
        kind: 'forecast',
        site_id: site.site_id,
        event_key: eventKey,
        value_in: next12,
        ...(at !== null ? { at_iso: new Date(at).toISOString() } : {}),
      });
    }
    const elapsed = onset === null ? null : sumRange(series.snowIn, onset, now + 1);
    const since = onset ?? now - 12 * HOUR;
    const nearby = reports
      .filter((r) => r.at >= since && r.at <= now && distanceMeters(r.lat, r.lon, site.lat, site.lon) <= DEPTH_REPORT_RADIUS_M)
      .sort((a, b) => b.at - a.at)[0];
    const known = [elapsed, nearby ? nearby.depth_in : null].filter((v): v is number => v !== null);
    if (known.length && Math.max(...known) >= trigger) {
      out.push({ kind: 'depth_report', site_id: site.site_id, event_key: eventKey, value_in: Math.max(...known) });
    }
  }
  const freeze = site.has_salt ? refreezeForecast(series, now, site.snow_on_ground) : null;
  if (freeze) {
    // Once per freeze: the hour it's due, rounded to the day, so tonight's freeze alerts once however often it's checked.
    out.push({ kind: 'refreeze', site_id: site.site_id, event_key: `refreeze:${new Date(freeze.at).toISOString().slice(0, 10)}`, value_in: null, at_iso: new Date(freeze.at).toISOString(), low_f: freeze.low_f, high_f: freeze.high_f, reason: freeze.reason, label: 'refreeze risk' });
  }
  return out;
}

export interface PriorSend {
  kind: AlertKind;
  site_id: string;
  event_key: string;
}

export interface ProposedAlert {
  kind: 'forecast' | 'depth_report' | 'refreeze';
  site_ids: string[];
  sites: SiteDecision[];
}

/**
 * Groups decisions into one alert per kind for the tenant. A site fires once per event per kind.
 * A kind that alerted under 30 minutes ago waits; unsent sites are simply re-proposed on the next poll.
 */
export function groupDecisions(
  decisions: SiteDecision[],
  prior: PriorSend[],
  recent: { kind: AlertKind; created_at: number }[],
  now: number,
): ProposedAlert[] {
  const sent = new Set(prior.map((p) => `${p.kind}|${p.site_id}|${p.event_key}`));
  const fresh = decisions.filter((d) => !sent.has(`${d.kind}|${d.site_id}|${d.event_key}`));
  const out: ProposedAlert[] = [];
  for (const kind of ['forecast', 'depth_report', 'refreeze'] as const) {
    const sites = fresh.filter((d) => d.kind === kind);
    if (!sites.length) continue;
    if (recent.some((r) => r.kind === kind && now - r.created_at < DEBOUNCE_MS)) continue;
    out.push({ kind, site_ids: [...new Set(sites.map((s) => s.site_id))], sites });
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

/** e.g. `Lakewood: 2.4" forecast by 5 AM, 18 sites at trigger.` */
export function alertHeadline(alert: ProposedAlert, area: string, tz: string): string {
  const n = alert.site_ids.length;
  const sites = `${n} site${n === 1 ? '' : 's'}`;
  if (alert.kind === 'refreeze') {
    const first = alert.sites.map((s) => s.at_iso).filter((v): v is string => Boolean(v)).sort()[0];
    const time = first ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric' }).format(new Date(first)) : null;
    const lows = alert.sites.map((s) => s.low_f).filter((v): v is number => typeof v === 'number');
    const salt = `${n} salt lot${n === 1 ? '' : 's'}`;
    if (alert.sites.some((s) => s.reason === 'ice')) return `${area}: freezing rain expected${time ? ` by ${time}` : ''} at ${salt}.`;
    return `${area}: refreeze risk at ${salt}. Melting now, below freezing${time ? ` by ${time}` : ''}${lows.length ? `, down to ${Math.round(Math.min(...lows))}°F` : ''}.`;
  }
  const values = alert.sites.map((s) => s.value_in).filter((v): v is number => v !== null);
  if (!values.length) return `${area}: refreeze risk at ${sites}.`;
  const max = Math.max(...values);
  if (alert.kind === 'depth_report') return `${area}: ${max}" reported or elapsed, ${sites} at trigger now.`;
  const at = alert.sites.map((s) => s.at_iso).filter((v): v is string => Boolean(v)).sort()[0];
  const by = at ? ` by ${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(at))}` : ' in the next 12 h';
  return `${area}: ${max}" forecast${by}, ${sites} at trigger.`;
}
