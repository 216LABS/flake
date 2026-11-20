import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, serviceDb, sql, trigger_alert } from '@flake/db';
import { setSetting } from '@/lib/providers';
import { areasKey, areaWeather, sameAreas, evaluateTenant, fetchAlerts, fetchCell, mapSites } from '@/lib/weather';
import { triggerTable } from '@/lib/triggers';
import { makeWorld, type World } from './helpers';

afterAll(() => closeDb());

/** Issue 198: lots in different service areas get their own alerts, warnings and weather rows. */
describe('snow triggers by service area', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await mapSites(w.tenantId);
    await serviceDb().execute(sql`alter table weather_snapshot disable trigger weather_snapshot_append_only`);
    await serviceDb().execute(sql`delete from weather_snapshot where request_url like 'mock://%' and source = 'nws_grid'`);
    await serviceDb().execute(sql`alter table weather_snapshot enable trigger weather_snapshot_append_only`);
    // The owner calls one lot's area Akron; the rest stay in their city.
    await setSetting(areasKey(w.tenantId), { [w.siteIds[0]!]: 'Akron' });
    const cells = await serviceDb().execute(sql`select distinct nws_office as office, nws_grid_x as x, nws_grid_y as y from site where tenant_id = ${w.tenantId} and nws_office is not null`) as unknown as { office: string; x: number; y: number }[];
    for (const c of cells) await fetchCell(c.office, c.x, c.y);
  });

  it("one area per city however its case was saved, in the owner's spelling if they named it (issue 206)", () => {
    const got = sameAreas([['a', 'LAKEWOOD'], ['b', 'Lakewood'], ['c', 'Fairview Park'], ['d', 'lakewood'], ['e', 'west side']], ['West Side']);
    expect(Object.fromEntries(got)).toEqual({ a: 'LAKEWOOD', b: 'LAKEWOOD', c: 'Fairview Park', d: 'LAKEWOOD', e: 'West Side' });
  });

  it('one forecast alert per area, each headed with its own area', async () => {
    await evaluateTenant(w.tenantId);
    const rows = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'forecast')));
    const byArea = new Map(rows.map((r) => [r.detail.area as string, r]));
    expect([...byArea.keys()].sort()).toEqual(['Akron', 'Lakewood']);
    expect(byArea.get('Akron')!.site_ids).toEqual([w.siteIds[0]]);
    expect(byArea.get('Akron')!.detail.headline).toMatch(/^Akron: /);
    expect(byArea.get('Lakewood')!.site_ids).not.toContain(w.siteIds[0]);
    expect(byArea.get('Lakewood')!.detail.headline).toMatch(/^Lakewood: /);
  });

  it('a winter warning seen from both areas alerts once', async () => {
    await fetchAlerts(w.tenantId);
    const rows = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'nws_alert')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail.area).toBeTruthy();
  });

  it('the dashboard and the triggers table show each area', async () => {
    const rows = await areaWeather(w.tenantId);
    expect(rows.map((r) => r.area).sort()).toEqual(['Akron', 'Lakewood']);
    expect(rows.every((r) => r.forecast_in !== null)).toBe(true);
    const table = await triggerTable(w.tenantId);
    expect(table.find((r) => r.id === w.siteIds[0])!.area).toBe('Akron');
    expect(table.some((r) => r.contract === 'signed' && r.trigger_in !== null)).toBe(true);
  });
});
