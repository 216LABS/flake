import { describe, expect, it } from 'vitest';
import { alertHeadline, evaluateSite, refreezeForecast, type HourBucket, type WeatherSeries } from '../src/trigger';

const H = 3_600_000;
const NOW = Date.parse('2026-11-16T18:00:00Z'); // 1 PM in New York
/** Hourly buckets from `from` hours ago, one value per hour. */
const hours = (fromHoursAgo: number, values: (number | null)[]): HourBucket[] => values.map((v, i) => ({ t: NOW - fromHoursAgo * H + i * H, v }));
const series = (over: Partial<WeatherSeries>): WeatherSeries => ({ snowIn: [], iceIn: [], tempF: [], ...over });
// Above freezing this afternoon, below by 4 hours from now.
const melt = hours(6, [30, 31, 33, 35, 37, 38, 38, 36, 34, 33, 31, 29, 27, 26, 25, 25]);
const site = { site_id: 's1', lat: 41.48, lon: -81.8, trigger_in: null, has_salt: true };

describe('refreeze alerts for salt lots', () => {
  it('a melt followed by a freeze, with snow still down, is a refreeze at the hour it drops to 32', () => {
    const r = refreezeForecast(series({ tempF: melt }), NOW, true);
    expect(r).toEqual({ at: NOW + 4 * H, reason: 'melt', low_f: 25, high_f: 38 });
  });
  it('counts snow from the last 48 hours of the forecast as snow still down', () => {
    expect(refreezeForecast(series({ tempF: melt, snowIn: hours(30, [2]) }), NOW)?.reason).toBe('melt');
  });
  it('no snow down, no melt, or a freeze too far off is nothing', () => {
    expect(refreezeForecast(series({ tempF: melt }), NOW)).toBeNull();
    expect(refreezeForecast(series({ tempF: hours(6, [20, 21, 22, 23, 24, 25, 26, 25, 24]) }), NOW, true)).toBeNull();
    expect(refreezeForecast(series({ tempF: hours(-20, [35, 31]) }), NOW, true)).toBeNull();
  });
  it('freezing rain in the next 12 hours is an ice alert whatever the ground', () => {
    const r = refreezeForecast(series({ iceIn: hours(-3, [0, 0.05]), tempF: hours(-3, [31, 30, 29]) }), NOW);
    expect(r).toMatchObject({ at: NOW + 4 * H, reason: 'ice', low_f: 29, high_f: null });
    expect(refreezeForecast(series({ iceIn: hours(-3, [0.05]) }), NOW)).toMatchObject({ reason: 'ice', low_f: null });
    // Out of order and with gaps, the earliest icing hour is the one named.
    expect(refreezeForecast(series({ iceIn: [{ t: NOW + 6 * H, v: 0.1 }, { t: NOW + 2 * H, v: null }, { t: NOW + 3 * H, v: 0.02 }] }), NOW)?.at).toBe(NOW + 3 * H);
  });
  it('only salt lots get one, once a day, and the headline says when and how cold', () => {
    expect(evaluateSite({ ...site, has_salt: false, snow_on_ground: true }, series({ tempF: melt }), NOW, [])).toEqual([]);
    const [d] = evaluateSite({ ...site, snow_on_ground: true }, series({ tempF: melt }), NOW, []);
    expect(d).toMatchObject({ kind: 'refreeze', event_key: 'refreeze:2026-11-16', reason: 'melt' });
    expect(alertHeadline({ kind: 'refreeze', site_ids: ['s1', 's2'], sites: [d!, { ...d!, site_id: 's2', low_f: null }] }, 'Lakewood', 'America/New_York'))
      .toBe('Lakewood: refreeze risk at 2 salt lots. Melting now, below freezing by Mon 5 PM, down to 25°F.');
    expect(alertHeadline({ kind: 'refreeze', site_ids: ['s1'], sites: [{ ...d!, reason: 'ice' }] }, 'Denver', 'America/Denver')).toBe('Denver: freezing rain expected by Mon 3 PM at 1 salt lot.');
    expect(alertHeadline({ kind: 'refreeze', site_ids: ['s1'], sites: [{ ...d!, at_iso: undefined, low_f: null }] }, 'Erie', 'America/New_York')).toBe('Erie: refreeze risk at 1 salt lot. Melting now, below freezing.');
    expect(alertHeadline({ kind: 'refreeze', site_ids: ['s1'], sites: [{ ...d!, at_iso: undefined, reason: 'ice' }] }, 'Erie', 'America/New_York')).toBe('Erie: freezing rain expected at 1 salt lot.');
  });
});
