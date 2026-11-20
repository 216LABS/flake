import { describe, expect, it } from 'vitest';
import { alertHeadline, DEFAULT_SALT_TRIGGER, evaluateSite, groupDecisions, triggerLine, type HourBucket, type SiteDecision, type TriggerSite, type WeatherSeries } from '../src/trigger';

/** Issue 204: salt runs per service area, for salt lots, apart from plow alerts. Nothing here is tuned to one region. */
const H = 3600000;
const T0 = Date.parse('2026-01-10T06:00:00Z');
const hrs = (vals: (number | null)[]): HourBucket[] => vals.map((v, i) => ({ t: T0 + i * H, v }));
const wx = (snow: number[], ice: number[] = [], temp: number[] = []): WeatherSeries => ({ snowIn: hrs(snow), iceIn: hrs(ice), tempF: hrs(temp) });
const lot = (id: string, over: Partial<TriggerSite>): TriggerSite => ({ site_id: id, lat: 41, lon: -81, trigger_in: 2, has_salt: false, ...over });

// Cleveland: 3" over the next hours. Akron: half an inch and freezing rain. Medina: dry and above freezing.
const CLEVELAND = wx([1, 1, 1], [], [28, 28, 28]);
const AKRON = wx([0.25, 0.25], [0, 0.05], [31, 30]);
const MEDINA = wx([0, 0, 0], [0, 0, 0], [38, 38, 38]);

describe('salt runs (issue 204)', () => {
  const lots = {
    clePlowSalt: lot('cle-1', { trigger_in: 2, has_salt: true }),
    clePlow: lot('cle-2', { trigger_in: 2 }),
    akrPlowSalt: lot('akr-1', { trigger_in: 2, has_salt: true }),
    akrSalt: lot('akr-2', { trigger_in: null, has_salt: true }),
    akrPlow: lot('akr-3', { trigger_in: 2 }),
    medPlowSalt: lot('med-1', { trigger_in: 2, has_salt: true }),
  };
  const area: Record<string, string> = { 'cle-1': 'Cleveland', 'cle-2': 'Cleveland', 'akr-1': 'Akron', 'akr-2': 'Akron', 'akr-3': 'Akron', 'med-1': 'Medina' };
  const weather: Record<string, WeatherSeries> = { Cleveland: CLEVELAND, Akron: AKRON, Medina: MEDINA };
  const decisions = Object.values(lots).flatMap((l) => evaluateSite(l, weather[area[l.site_id]!]!, T0, []));
  const alerts = groupDecisions(decisions, [], [], T0, (id) => area[id]!);

  it('Cleveland gets a plow alert with its lots, Akron a salt run with only its salt lots, Medina nothing', () => {
    expect(alerts.map((a) => [a.kind, a.area, a.site_ids])).toEqual([
      ['forecast', 'Cleveland', ['cle-1', 'cle-2']],
      ['salt_run', 'Akron', ['akr-1', 'akr-2']],
    ]);
    // No Medina lot on any alert, and no plow-only lot on a salt run.
    expect(alerts.flatMap((a) => a.site_ids)).not.toContain('med-1');
    expect(alerts.find((a) => a.kind === 'salt_run')!.site_ids).not.toContain('akr-3');
  });

  it('headlines say the area, the amount or condition, and plow vs salt', () => {
    const [cle, akr] = alerts;
    expect(alertHeadline(cle!, 'Cleveland', 'America/New_York')).toBe('Cleveland: 3" forecast by 3 AM, 2 sites at trigger, plow, 1 with salt.');
    expect(alertHeadline(akr!, 'Akron', 'America/New_York')).toBe('Akron: 0.5" + freezing rain by Sat 2 AM, salt only. 2 salt lots.');
  });

  it('each area reads as one line for the dashboard and the triggers table', () => {
    const of = (name: string) => triggerLine(decisions.filter((d) => area[d.site_id] === name));
    expect(of('Cleveland')).toEqual({ plow: true, salt: true, text: '3" forecast, plow + salt' });
    expect(of('Akron')).toEqual({ plow: false, salt: true, text: '0.5" + freezing rain, salt only' });
    expect(of('Medina')).toEqual({ plow: false, salt: false, text: 'No trigger' });
  });

  it('a plow + salt lot at its plow trigger is not also put on a salt run for the same snow', () => {
    const d = evaluateSite(lots.clePlowSalt, CLEVELAND, T0, []);
    expect(d.map((x) => x.kind)).toEqual(['forecast']);
    expect(d[0]!.salt).toBe(true);
    // Freezing rain on top of plowable snow still calls for salt: the plow alert doesn't cover ice.
    const icy = evaluateSite(lots.clePlowSalt, wx([1, 1, 1], [0.05], [30]), T0, []);
    expect(icy.map((x) => [x.kind, x.reasons ?? null])).toEqual([['forecast', null], ['salt_run', ['ice']]]);
  });

  it('salt settings: the default salts on any snow, ice and refreeze; a lot can turn each off or raise the snow', () => {
    expect(DEFAULT_SALT_TRIGGER).toEqual({ snow_in: 0, ice: true, refreeze: true });
    const dusting = wx([0.2], [], [30]);
    expect(evaluateSite(lots.akrSalt, dusting, T0, [])[0]).toMatchObject({ kind: 'salt_run', reasons: ['snow'], value_in: 0.2 });
    expect(evaluateSite({ ...lots.akrSalt, salt: { snow_in: 1, ice: true, refreeze: true } }, dusting, T0, [])).toEqual([]);
    expect(evaluateSite({ ...lots.akrSalt, salt: { snow_in: null, ice: true, refreeze: true } }, dusting, T0, [])).toEqual([]);
    expect(evaluateSite({ ...lots.akrSalt, salt: { snow_in: null, ice: false, refreeze: true } }, wx([0], [0.05], [31]), T0, [])).toEqual([]);
    // A lot with no salt in its contract never gets a salt run, whatever falls.
    expect(evaluateSite(lots.akrPlow, AKRON, T0, [])).toEqual([]);
  });

  it('refreeze can be turned off, and a refreeze salt run says when and how cold', () => {
    // Snow on the ground, melting at 34 F, then 28 F: a refreeze.
    const melt = wx([0], [0, 0, 0], [34, 34, 28]);
    const ground = { ...lots.akrSalt, snow_on_ground: true };
    expect(evaluateSite({ ...ground, salt: { snow_in: null, ice: true, refreeze: false } }, melt, T0, [])).toEqual([]);
    const [d] = evaluateSite(ground, melt, T0, []);
    expect(d).toMatchObject({ kind: 'salt_run', reasons: ['melt'], low_f: 28 });
    expect(alertHeadline({ kind: 'salt_run', site_ids: ['akr-2'], sites: [d!] }, 'Akron', 'America/New_York')).toBe('Akron: refreeze by Sat 3 AM, down to 28°F, salt only. 1 salt lot.');
  });

  it('a plow area with freezing rain on top says so', () => {
    const plowIce = evaluateSite(lots.clePlowSalt, wx([1, 1, 1], [0.05], [30]), T0, []);
    expect(triggerLine(plowIce).text).toBe('3" forecast + freezing rain, plow + salt');
  });

  it('edge cases: driver depth on a salt lot, every salt rule off, a dusting that only rounds up to a tenth', () => {
    // A driver's 3" report at a plow + salt lot: at trigger now, plow + salt.
    const [depth] = evaluateSite(lots.clePlowSalt, wx([0]), T0, [{ lat: 41, lon: -81, depth_in: 3, at: T0 - 60000 }]);
    expect(depth).toMatchObject({ kind: 'depth_report', salt: true, value_in: 3 });
    expect(triggerLine([depth!]).text).toBe('3" down, plow + salt');
    expect(evaluateSite({ ...lots.akrSalt, salt: { snow_in: 0, ice: false, refreeze: false } }, wx([0], [0.05], [30]), T0, [])).toEqual([]);
    // 0.03" an hour totals 0.1" once rounded, but never actually reaches it hour by hour: no "by" time.
    const [dust] = evaluateSite(lots.akrSalt, wx([0.03, 0.03, 0.03]), T0, []);
    expect(dust).toMatchObject({ kind: 'salt_run', reasons: ['snow'] });
    expect(dust!.at_iso).toBeUndefined();
    expect(alertHeadline({ kind: 'salt_run', site_ids: ['akr-2'], sites: [dust!] }, 'Akron', 'UTC')).toBe('Akron: 0.1", salt only. 1 salt lot.');
  });

  it('old refreeze alerts and plow alerts where every lot has salt read right', () => {
    const old: SiteDecision = { kind: 'refreeze', site_id: 'x', event_key: 'refreeze:2026-01-10', value_in: null, reason: 'ice' };
    const plow: SiteDecision = { kind: 'depth_report', site_id: 'y', event_key: 'e', value_in: null };
    expect(triggerLine([plow, old]).text).toBe('At trigger + freezing rain, plow + salt');
    expect(triggerLine([{ ...old, reason: undefined }]).text).toBe('Salt conditions, salt only');
    const all = evaluateSite(lots.clePlowSalt, CLEVELAND, T0, []);
    expect(alertHeadline({ kind: 'forecast', site_ids: ['cle-1'], sites: all }, 'Cleveland', 'UTC')).toMatch(/, plow \+ salt\.$/);
  });

  it('a salt run on snow fires once per storm, a freeze once per day', () => {
    const [d] = evaluateSite(lots.akrSalt, wx([0.3]), T0, []) as SiteDecision[];
    expect(d!.event_key).toMatch(/^salt:/);
    expect(groupDecisions([d!], [{ kind: 'salt_run', site_id: d!.site_id, event_key: d!.event_key }], [], T0)).toEqual([]);
    const [f] = evaluateSite(lots.akrSalt, wx([0], [0.05], [31]), T0, []);
    expect(f!.event_key).toBe('refreeze:2026-01-10');
  });
});
