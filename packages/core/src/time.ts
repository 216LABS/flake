/** Formats an instant in a tenant time zone. All storage is UTC; only display is local. */
export function fmtLocal(iso: string | number | Date, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    ...(opts ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  }).format(new Date(iso));
}

export function localHm(at: number | Date, tz: string): { hm: string; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { hm: `${get('hour')}:${get('minute')}`, date: `${get('year')}-${get('month')}-${get('day')}` };
}

/**
 * The UTC instant of a wall-clock time (HH:MM) on a YYYY-MM-DD date in a time zone. Correct on DST days: 8:00 is
 * 8:00 local, not midnight plus eight hours, which is 7:00 or 9:00 on the two change days.
 */
export function zonedTime(ymd: string, hm: string, tz: string): Date {
  const wanted = Date.parse(`${ymd}T${hm}:00Z`);
  let t = wanted;
  // Two rounds: the first uses the offset at a guess, the second the offset at the answer, which differ only near a change.
  for (let i = 0; i < 2; i++) {
    const shown = localHm(t, tz);
    t -= Date.parse(`${shown.date}T${shown.hm}:00Z`) - wanted;
  }
  return new Date(t);
}

/** The UTC instant of local midnight on a YYYY-MM-DD date in a time zone. */
export function zonedDayStart(ymd: string, tz: string): Date {
  return zonedTime(ymd, '00:00', tz);
}

/** A calendar date some days later (or earlier), as YYYY-MM-DD. Noon UTC keeps it clear of every zone's midnight. */
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** The last second of a local calendar date: the next day's midnight, less one second. */
export function zonedDayEnd(ymd: string, tz: string): Date {
  return new Date(zonedDayStart(addDays(ymd, 1), tz).getTime() - 1000);
}

/** Now if it is within 8 AM to 8 PM local, otherwise the next 8 AM. For invoice texts. */
export function nextInvoiceWindow(now: Date, tz: string): Date {
  const { hm, date } = localHm(now, tz);
  if (hm >= '08:00' && hm < '20:00') return now;
  return zonedTime(hm < '08:00' ? date : addDays(date, 1), '08:00', tz);
}

export interface ServiceWindow {
  open_by?: string;
  days?: string[];
}

/**
 * A stop is late when its site has an open_by time, the storm started before that time on the current
 * local day (or on an earlier day), and the current local time is past it.
 */
export function isLate(window: ServiceWindow | null | undefined, stormStartedAt: number, now: number, tz: string): boolean {
  if (!window?.open_by) return false;
  const current = localHm(now, tz);
  const started = localHm(stormStartedAt, tz);
  if (window.days?.length) {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(now)).toLowerCase();
    if (!window.days.map((d) => d.toLowerCase().slice(0, 3)).includes(day)) return false;
  }
  if (current.hm <= window.open_by) return false;
  // Storm began today after the deadline had already passed: nothing was promised for today.
  if (started.date === current.date && started.hm > window.open_by) return false;
  return true;
}

/**
 * The snow season a date falls in, like "2026-27". From July on it is the winter ahead. Decided in the company's time
 * zone when given: 1 AM UTC on July 1 is still June 30 in Ohio. Without one it uses the device's own zone, which is
 * right in a browser and wrong on a UTC server.
 */
export function currentSeason(now = new Date(), tz?: string): string {
  const [year, month] = tz ? localHm(now, tz).date.split('-').map(Number) as [number, number] : [now.getFullYear(), now.getMonth() + 1];
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/**
 * The signed contract in force at a moment, from a lot's contracts listed newest first. The one for that season wins.
 * A renewal already signed for a later season never prices or triggers today's work. Seasons written some other way
 * than "2026-27" can't be placed, so for those the newest stands.
 */
export function liveContract<T extends { season: string }>(newestFirst: T[], at: Date | string | number = new Date(), tz?: string): T | undefined {
  const now = currentSeason(new Date(at), tz);
  const exact = newestFirst.find((c) => c.season === now);
  if (exact) return exact;
  const later = (s: string) => /^\d{4}-\d{2}$/.test(s) && s > now;
  return newestFirst.find((c) => !later(c.season));
}

/** liveContract for each lot, from contracts listed newest first. */
export function liveContracts<T extends { season: string; site_id: string }>(newestFirst: T[], at: Date | string | number = new Date(), tz?: string): T[] {
  const bySite = new Map<string, T[]>();
  for (const c of newestFirst) bySite.set(c.site_id, [...(bySite.get(c.site_id) ?? []), c]);
  return [...bySite.values()].flatMap((list) => {
    const c = liveContract(list, at, tz);
    return c ? [c] : [];
  });
}
