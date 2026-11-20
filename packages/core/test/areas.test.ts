import { describe, expect, it } from 'vitest';
import { alertHeadline, groupDecisions, serviceArea, type SiteDecision } from '../src/trigger';

/** Issue 198: Lakewood and Akron get different snow, so they get different alerts. */
describe('snow alerts by service area', () => {
  const d = (site_id: string, value_in: number): SiteDecision => ({ kind: 'forecast', site_id, event_key: 'e1', value_in, at_iso: '2026-12-01T10:00:00Z' });
  const area: Record<string, string> = { a1: 'Lakewood', a2: 'Lakewood', b1: 'Akron' };

  it('a lot is in its owner-named area, or else its city', () => {
    expect(serviceArea('1 Main St, Lakewood, OH 44107')).toBe('Lakewood');
    expect(serviceArea('1 Main St, Lakewood, OH 44107', 'West side')).toBe('West side');
    expect(serviceArea('1 Main St, Lakewood, OH', '  ')).toBe('Lakewood');
    expect(serviceArea('no commas here')).toBe('Your area');
    expect(serviceArea('12700 Lake Ave Lakewood OH')).toBe('Lakewood');
  });

  it('one alert per area, each naming its own area', () => {
    const out = groupDecisions([d('a1', 2.4), d('a2', 3), d('b1', 5.1)], [], [], Date.now(), (id) => area[id]!);
    expect(out.map((p) => [p.area, p.site_ids.sort()])).toEqual([['Akron', ['b1']], ['Lakewood', ['a1', 'a2']]]);
    const akron = out.find((p) => p.area === 'Akron')!;
    expect(alertHeadline(akron, akron.area!, 'America/New_York')).toMatch(/^Akron: 5.1"/);
  });

  it('a recent alert in one area does not hold back the other', () => {
    const out = groupDecisions([d('a1', 2.4), d('b1', 5.1)], [], [{ kind: 'forecast', created_at: Date.now() - 60_000, area: 'Lakewood' }], Date.now(), (id) => area[id]!);
    expect(out.map((p) => p.area)).toEqual(['Akron']);
  });

  it('without areas it is one alert for every lot, as before', () => {
    const out = groupDecisions([d('a1', 2.4), d('b1', 5.1)], [], [], Date.now());
    expect(out).toHaveLength(1);
    expect(out[0]!.area).toBeUndefined();
  });
});
