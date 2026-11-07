import { describe, expect, it } from 'vitest';
import { alertHeadline, durationHours, evaluateSite, expandSeries, findOnset, groupDecisions, newWinterAlerts, reachesTriggerAt, sumRange, summarize, toFahrenheit, toInches, type HourBucket, type TriggerSite, type WeatherSeries } from '../src/trigger';

const H = 3600000;
const T0 = Date.parse('2025-12-12T00:00:00Z');
const series = (vals: (number | null)[]): HourBucket[] => vals.map((v, i) => ({ t: T0 + i * H, v }));
const wx = (snow: (number | null)[], over: Partial<WeatherSeries> = {}): WeatherSeries => ({ snowIn: series(snow), iceIn: [], tempF: [], ...over });
const site: TriggerSite = { site_id: 's1', lat: 41.48, lon: -81.8, trigger_in: 2, has_salt: false };

describe('units and parsing', () => {
  it('converts layer units', () => {
    expect(toInches(25.4, 'wmoUnit:mm')).toBe(1);
    expect(toInches(25.4, null)).toBe(1);
    expect(toInches(2.54, 'wmoUnit:cm')).toBe(1);
    expect(toInches(1, 'wmoUnit:m')).toBeCloseTo(39.37, 2);
    expect(toInches(3, 'in')).toBe(3);
    expect(toFahrenheit(0, 'wmoUnit:degC')).toBe(32);
    expect(toFahrenheit(10, null)).toBe(50);
    expect(toFahrenheit(10, 'wmoUnit:degF')).toBe(10);
  });
  it('parses durations and rejects others', () => {
    expect(durationHours('PT6H')).toBe(6);
    expect(durationHours('P1DT6H')).toBe(30);
    expect(durationHours('P1D')).toBe(24);
    expect(durationHours('PT30M')).toBe(0.5);
    expect(() => durationHours('nope')).toThrow();
  });
  it('expands and pro-rates; null stays null, never zero', () => {
    const b = expandSeries([{ validTime: '2025-12-12T06:00:00+00:00/PT2H', value: 25.4 }, { validTime: '2025-12-12T00:00:00+00:00/PT1H', value: null }], (v) => toInches(v, 'wmoUnit:mm'));
    expect(b).toHaveLength(3);
    expect(b[0]!.v).toBeNull();
    expect(b[1]!.v).toBe(0.5);
    expect(expandSeries([{ validTime: '2025-12-12T06:00:00+00:00/PT2H', value: 20 }], (v) => v, false)[1]!.v).toBe(20);
    expect(expandSeries([{ validTime: '2025-12-12T06:00:00+00:00/PT30M', value: 1 }], (v) => v)).toHaveLength(1);
  });
  it('sumRange returns null when unavailable', () => {
    expect(sumRange(series([null, null]), T0, T0 + 2 * H)).toBeNull();
    expect(sumRange(series([1, null, 2]), T0, T0 + 3 * H)).toBe(3);
    expect(sumRange(series([1]), T0 + 5 * H, T0 + 6 * H)).toBeNull();
  });
});

describe('findOnset', () => {
  it('finds the current event and ends it after 6 h of zero', () => {
    expect(findOnset(series([0, 1, 1, 0, 0, 1]), T0 + 5 * H)).toBe(T0 + H);
    expect(findOnset(series([1, 0, 0, 0, 0, 0, 0, 0]), T0 + 7 * H)).toBeNull();
    expect(findOnset(series([1, 0, 0, 0, 0, 0, 0, 2]), T0 + 7 * H)).toBe(T0 + 7 * H);
    expect(findOnset(series([0, 0, 5]), T0 + H)).toBeNull();
  });
  it('null hours neither start nor end an event', () => {
    expect(findOnset(series([1, null, null, null, null, null, null, null]), T0 + 7 * H)).toBe(T0);
  });
});

describe('summarize', () => {
  it('reports forecast, elapsed and the latest known temperature', () => {
    expect(summarize(wx([1, 1, 1, 1], { tempF: series([30, null, 28, 99]) }), T0 + 2 * H)).toEqual({ snow_next12h_in: 2, snow_elapsed_in: 3, temp_f: 28 });
  });
  it('elapsed is 0 with no event, and everything unavailable stays null', () => {
    expect(summarize(wx([0, 0, 1]), T0 + H).snow_elapsed_in).toBe(0);
    const s = summarize(wx([]), T0);
    expect(s.snow_next12h_in).toBeNull();
    expect(s.temp_f).toBeNull();
  });
});

describe('reachesTriggerAt', () => {
  it('finds the hour the sum crosses, skipping nulls and out-of-range hours', () => {
    expect(reachesTriggerAt(series([5, null, 1, 1]), T0 + H, T0 + 4 * H, 2)).toBe(T0 + 4 * H);
    expect(reachesTriggerAt(series([0.1]), T0, T0 + H, 2)).toBeNull();
  });
});

describe('evaluateSite', () => {
  it('fires forecast when next 12 h reaches the trigger', () => {
    const d = evaluateSite(site, wx([0, 1, 1.5]), T0, []);
    expect(d.map((x) => x.kind)).toEqual(['forecast']);
    expect(d[0]!.value_in).toBe(2.5);
    expect(d[0]!.at_iso).toBe(new Date(T0 + 3 * H).toISOString());
    expect(d[0]!.event_key).toBe(new Date(T0 + H).toISOString());
  });
  it('omits at_iso when many small hours round up to the trigger', () => {
    const d = evaluateSite(site, wx([0.97, 0.98]), T0, []);
    expect(d[0]!.value_in).toBe(2);
    expect(d[0]!.at_iso).toBeUndefined();
  });
  it('does not fire on unavailable data or below trigger', () => {
    expect(evaluateSite(site, wx([null, null]), T0, [])).toEqual([]);
    expect(evaluateSite(site, wx([0.5]), T0, [])).toEqual([]);
  });
  it('fires depth_report on elapsed snowfall', () => {
    expect(evaluateSite(site, wx([1.5, 1, 0]), T0 + 2 * H, []).find((x) => x.kind === 'depth_report')!.value_in).toBe(2.5);
  });
  it('fires depth_report on a nearby driver report during a quiet forecast, using a quiet key', () => {
    const d = evaluateSite(site, wx([0, 0, 0]), T0 + 2 * H, [{ lat: 41.481, lon: -81.801, depth_in: 3, at: T0 + H }]);
    expect(d[0]!.kind).toBe('depth_report');
    expect(d[0]!.event_key.startsWith('quiet:')).toBe(true);
  });
  it('uses the latest nearby report and ignores far, future or pre-event reports', () => {
    const reports = [
      { lat: 41.481, lon: -81.801, depth_in: 1, at: T0 + 3 * H },
      { lat: 41.481, lon: -81.801, depth_in: 9, at: T0 + 2 * H },
      { lat: 42.5, lon: -81.8, depth_in: 9, at: T0 + 3 * H },
      { lat: 41.481, lon: -81.801, depth_in: 9, at: T0 + 9 * H },
    ];
    expect(evaluateSite(site, wx([0, 0, 0, 0.1]), T0 + 3 * H, reports)).toEqual([]);
  });
  it('takes the newest of several nearby reports', () => {
    const reports = [{ lat: 41.481, lon: -81.801, depth_in: 9, at: T0 + H }, { lat: 41.481, lon: -81.801, depth_in: 1, at: T0 + 2 * H }];
    expect(evaluateSite(site, wx([0, 0, 0]), T0 + 2 * H, reports)).toEqual([]);
    expect(evaluateSite(site, wx([0, 0, 0]), T0 + 2 * H, [...reports].reverse())).toEqual([]);
  });
  it('skips trigger logic for a site with no trigger', () => {
    expect(evaluateSite({ ...site, trigger_in: null }, wx([5]), T0, [])).toEqual([]);
  });
  it('refreeze: ice in the next 6 h for salt services', () => {
    const d = evaluateSite({ ...site, trigger_in: null, has_salt: true }, wx([0], { iceIn: series([0.1]) }), T0, []);
    expect(d[0]!.label).toBe('refreeze risk');
    expect(d[0]!.value_in).toBeNull();
    expect(evaluateSite({ ...site, trigger_in: null, has_salt: false }, wx([0], { iceIn: series([0.1]) }), T0, [])).toEqual([]);
  });
  it('refreeze: temperature crossing 32 down after snow', () => {
    const s = { ...site, trigger_in: null, has_salt: true };
    expect(evaluateSite(s, wx([0.5], { tempF: series([35, 34, 31]) }), T0, [])).toHaveLength(1);
    expect(evaluateSite(s, wx([0.5], { tempF: series([31, 30]) }), T0, [])).toEqual([]);
    expect(evaluateSite(s, wx([0.5], { tempF: series([35, null, 36]), iceIn: series([0]) }), T0, [])).toEqual([]);
    expect(evaluateSite(s, wx([0], { tempF: series([35, 31]) }), T0, [])).toEqual([]);
    expect(evaluateSite(s, wx([null], { tempF: series([35, 31]) }), T0, [])).toEqual([]);
  });
});

describe('groupDecisions', () => {
  const d = (site_id: string, kind: 'forecast' | 'depth_report' = 'forecast') => ({ kind, site_id, event_key: 'e1', value_in: 3 });
  it('groups per kind and dedupes site ids', () => {
    expect(groupDecisions([d('a'), d('b'), d('a'), d('a', 'depth_report')], [], [], T0).map((a) => [a.kind, a.site_ids])).toEqual([['forecast', ['a', 'b']], ['depth_report', ['a']]]);
  });
  it('fires once per site per event', () => {
    expect(groupDecisions([d('a'), d('b')], [{ kind: 'forecast', site_id: 'a', event_key: 'e1' }], [], T0)[0]!.site_ids).toEqual(['b']);
    expect(groupDecisions([d('a')], [{ kind: 'forecast', site_id: 'a', event_key: 'e1' }], [], T0)).toEqual([]);
  });
  it('debounces a kind for 30 minutes', () => {
    expect(groupDecisions([d('a')], [], [{ kind: 'forecast', created_at: T0 - 10 * 60000 }], T0)).toEqual([]);
    expect(groupDecisions([d('a')], [], [{ kind: 'forecast', created_at: T0 - 31 * 60000 }], T0)).toHaveLength(1);
    expect(groupDecisions([d('a')], [], [{ kind: 'depth_report', created_at: T0 }], T0)).toHaveLength(1);
  });
});

describe('alerts', () => {
  it('newWinterAlerts keeps unseen winter events', () => {
    const a = [{ id: '1', event: 'Winter Storm Warning' }, { id: '2', event: 'Flood Watch' }, { id: '3', event: 'Lake Effect Snow Warning' }];
    expect(newWinterAlerts(a, ['3']).map((x) => x.id)).toEqual(['1']);
  });
  it('alertHeadline writes forecast with a time, without a time, depth, refreeze and singular', () => {
    const base = { kind: 'forecast' as const, site_ids: ['a', 'b'] };
    expect(alertHeadline({ ...base, sites: [{ kind: 'forecast', site_id: 'a', event_key: 'e', value_in: 2.4, at_iso: '2025-12-12T10:00:00Z' }, { kind: 'forecast', site_id: 'b', event_key: 'e', value_in: 1 }] }, 'Lakewood', 'America/New_York')).toBe('Lakewood: 2.4" forecast by 5 AM, 2 sites at trigger.');
    expect(alertHeadline({ ...base, site_ids: ['a'], sites: [{ kind: 'forecast', site_id: 'a', event_key: 'e', value_in: 2 }] }, 'X', 'UTC')).toBe('X: 2" forecast in the next 12 h, 1 site at trigger.');
    expect(alertHeadline({ kind: 'depth_report', site_ids: ['a'], sites: [{ kind: 'depth_report', site_id: 'a', event_key: 'e', value_in: 3 }] }, 'X', 'UTC')).toBe('X: 3" reported or elapsed, 1 site at trigger now.');
    expect(alertHeadline({ ...base, site_ids: ['a'], sites: [{ kind: 'forecast', site_id: 'a', event_key: 'e', value_in: null, label: 'refreeze risk' }] }, 'X', 'UTC')).toBe('X: refreeze risk at 1 site.');
  });
});
