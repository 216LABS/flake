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

/** The UTC instant of local midnight on a YYYY-MM-DD date in a time zone. */
export function zonedDayStart(ymd: string, tz: string): Date {
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  const { hm, date } = localHm(guess, tz);
  const shownAsUtc = Date.parse(`${date}T${hm}:00Z`);
  return new Date(guess - (shownAsUtc - guess));
}

/** Now if it is within 8 AM to 8 PM local, otherwise the next 8 AM. For invoice texts. */
export function nextInvoiceWindow(now: Date, tz: string): Date {
  const { hm, date } = localHm(now, tz);
  if (hm >= '08:00' && hm < '20:00') return now;
  const day = hm < '08:00' ? date : new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return new Date(zonedDayStart(day, tz).getTime() + 8 * 3600000);
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

/** The snow season a date falls in, like "2026-27". From July on it is the winter ahead. */
export function currentSeason(now = new Date()): string {
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/**
 * The signed contract in force at a moment, from a lot's contracts listed newest first. The one for that season wins.
 * A renewal already signed for a later season never prices or triggers today's work. Seasons written some other way
 * than "2026-27" can't be placed, so for those the newest stands.
 */
export function liveContract<T extends { season: string }>(newestFirst: T[], at: Date | string | number = new Date()): T | undefined {
  const now = currentSeason(new Date(at));
  const exact = newestFirst.find((c) => c.season === now);
  if (exact) return exact;
  const later = (s: string) => /^\d{4}-\d{2}$/.test(s) && s > now;
  return newestFirst.find((c) => !later(c.season));
}

/** liveContract for each lot, from contracts listed newest first. */
export function liveContracts<T extends { season: string; site_id: string }>(newestFirst: T[], at: Date | string | number = new Date()): T[] {
  const bySite = new Map<string, T[]>();
  for (const c of newestFirst) bySite.set(c.site_id, [...(bySite.get(c.site_id) ?? []), c]);
  return [...bySite.values()].flatMap((list) => {
    const c = liveContract(list, at);
    return c ? [c] : [];
  });
}
