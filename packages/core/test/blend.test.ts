import { describe, expect, it } from 'vitest';
import { alertConfidence, alertHeadline, blendNowcast, confidenceOf, evaluateSite, percentilesOver, triggerLine, type HourBucket, type TriggerSite, type WeatherSeries } from '../src/trigger';

/** Issue 203: the Blend's percentiles say how sure, HRRR sharpens the next hours, and either missing changes nothing. */
const H = 3600000;
const T0 = Date.parse('2026-01-15T00:00:00Z');
const hrs = (vals: (number | null)[]): HourBucket[] => vals.map((v, i) => ({ t: T0 + i * H, v }));
const wx = (snow: (number | null)[]): WeatherSeries => ({ snowIn: hrs(snow), iceIn: [], tempF: [] });
const lot: TriggerSite = { site_id: 'a', lat: 44.9, lon: -93.2, trigger_in: 2, has_salt: false };
const iso = (h: number) => new Date(T0 + h * H).toISOString();
const windows = [0, 6, 12].map((h) => ({ start: iso(h), end: iso(h + 6) }));

describe('likely vs certain (Blend of models)', () => {
  it('certain when the 10th percentile reaches the trigger, likely at the median, possible below', () => {
    expect(confidenceOf({ p10: 2, p50: 3, p90: 5 }, 2)).toBe('certain');
    expect(confidenceOf({ p10: 0.5, p50: 2.5, p90: 5 }, 2)).toBe('likely');
    expect(confidenceOf({ p10: 0, p50: 1, p90: 4 }, 2)).toBe('possible');
  });

  it('percentiles over the next 12 hours count each 6-hour window for its part inside', () => {
    const vals = { p10: [1, 1, 1], p50: [2, 2, 2], p90: [4, 4, 4] };
    expect(percentilesOver(windows, vals, T0, T0 + 12 * H)).toEqual({ p10: 2, p50: 4, p90: 8 });
    // From 3 h in: half of the first window, all of the second, half of the third.
    expect(percentilesOver(windows, vals, T0 + 3 * H, T0 + 15 * H)).toEqual({ p10: 2, p50: 4, p90: 8 });
    // A window the model has no value for isn't zero, and too little coverage is no answer at all.
    expect(percentilesOver(windows, { p10: [null, null, 1], p50: [null, null, 2], p90: [null, null, 4] }, T0, T0 + 12 * H)).toBeNull();
  });

  it('a forecast alert carries how sure, and the headline and area line say it', () => {
    const [d] = evaluateSite(lot, wx([1, 1, 1]), T0, [], { nbm: { p10: 0.8, p50: 2.6, p90: 5 } });
    expect(d).toMatchObject({ kind: 'forecast', value_in: 3, confidence: 'likely', range_in: [0.8, 5] });
    expect(alertHeadline({ kind: 'forecast', site_ids: ['a'], sites: [d!] }, 'Minneapolis', 'America/Chicago')).toBe('Minneapolis: 3" forecast (likely) by 8 PM, 1 site at trigger, plow.');
    expect(triggerLine([d!]).text).toBe('3" forecast (likely), plow');
    const [sure] = evaluateSite(lot, wx([1, 1, 1]), T0, [], { nbm: { p10: 2.2, p50: 3, p90: 4 } });
    // An alert is only as sure as its least sure lot.
    expect(alertConfidence([d!, sure!])).toBe('likely');
    expect(alertConfidence([sure!])).toBe('certain');
  });

  it('the Blend alone can raise a likely alert the NWS grid misses, but not on a long shot', () => {
    const [d] = evaluateSite(lot, wx([0.2, 0.2]), T0, [], { nbm: { p10: 1, p50: 2.4, p90: 4 } });
    expect(d).toMatchObject({ kind: 'forecast', value_in: 2.4, confidence: 'likely' });
    expect(evaluateSite(lot, wx([0.2, 0.2]), T0, [], { nbm: { p10: 0, p50: 1, p90: 4 } })).toEqual([]);
  });

  it('with no Blend run (down, or not out yet) it decides exactly as before, from the NWS grid alone', () => {
    const before = evaluateSite(lot, wx([1, 1, 1]), T0, []);
    expect(evaluateSite(lot, wx([1, 1, 1]), T0, [], { nbm: null })).toEqual(before);
    expect(before[0]!.confidence).toBeUndefined();
    expect(alertHeadline({ kind: 'forecast', site_ids: ['a'], sites: before }, 'X', 'UTC')).toBe('X: 3" forecast by 2 AM, 1 site at trigger, plow.');
  });
});

describe('HRRR nowcast during storms', () => {
  it('replaces the hours it covers and keeps the rest of the NWS grid', () => {
    const nws = wx([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5, 0.5]);
    const out = blendNowcast(nws, { hours: [iso(0), iso(1), iso(2)], snow: [0.6, null, 0.8], ice: [0, 0, 0.02] });
    expect(out.snowIn.map((b) => b.v)).toEqual([0.6, 0.1, 0.8, 0.1, 0.1, 0.1, 0.5, 0.5]);
    expect(out.iceIn.find((b) => b.t === T0 + 2 * H)?.v).toBe(0.02);
  });

  it('a heavier nowcast can put a lot at trigger the grid had under it', () => {
    const nws = wx([0.2, 0.2, 0.2, 0.2]);
    expect(evaluateSite(lot, nws, T0, [])).toEqual([]);
    const blended = blendNowcast(nws, { hours: [iso(0), iso(1), iso(2)], snow: [0.7, 0.7, 0.7], ice: [0, 0, 0] });
    expect(evaluateSite(lot, blended, T0, [])[0]).toMatchObject({ kind: 'forecast', value_in: 2.3 });
  });

  it('no nowcast (down, or no storm) leaves the grid as it is', () => {
    const nws = wx([1, 1]);
    expect(blendNowcast(nws, null)).toBe(nws);
  });
});
