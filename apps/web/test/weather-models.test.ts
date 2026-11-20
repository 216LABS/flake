import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, closeDb, desc, eq, serviceDb, sql, trigger_alert, weather_snapshot } from '@flake/db';
import * as providers from '@/lib/providers';
import { setSetting, weatherNow } from '@/lib/providers';
import { evaluateTenant, fetchCell, fetchModel, latestModels, lotWeather, mapSites } from '@/lib/weather';
import { makeWorld, type World } from './helpers';

afterAll(() => closeDb());

/**
 * Issue 203 end to end, on synthetic data: the Blend, HRRR and radar are fetched for every lot in one pass each,
 * stored, and used; and when one is down the NWS grid alone still alerts.
 */
describe('Blend of models, HRRR and radar', () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
    await setSetting('dev.weather_fixture', 'lakewood-lake-effect-2025-12');
    await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    await mapSites(w.tenantId);
    const cells = await serviceDb().execute(sql`select distinct nws_office as office, nws_grid_x as x, nws_grid_y as y from site where tenant_id = ${w.tenantId} and nws_office is not null`) as unknown as { office: string; x: number; y: number }[];
    for (const c of cells) await fetchCell(c.office, c.x, c.y);
  });

  it('each source is one snapshot covering every lot, and a run already stored is not fetched again', async () => {
    for (const kind of ['nbm', 'nowcast', 'radar'] as const) await fetchModel(kind);
    const now = (await weatherNow()).getTime();
    const models = await latestModels(now);
    expect(Object.keys(models).sort()).toEqual(['nbm', 'nowcast', 'radar']);
    for (const id of w.siteIds) expect(models.nbm!.summary.sites[id]).toBeTruthy();
    expect(models.nbm!.summary.windows).toHaveLength(4);
    expect(models.nbm!.storage_path).toMatch(/^nbm\//);
    // Same run again: nothing new is stored.
    expect(await fetchModel('nbm')).toBeNull();
  });

  it('a forecast alert says how sure the models are, and the dashboard numbers come from the blend', async () => {
    await evaluateTenant(w.tenantId);
    const [a] = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), eq(trigger_alert.kind, 'forecast'))).orderBy(desc(trigger_alert.created_at)).limit(1);
    expect(a!.detail.headline).toMatch(/forecast \((certain|likely|possible)\)/);
    expect(a!.detail.sites.every((s: { confidence?: string; range_in?: number[] }) => s.confidence && s.range_in?.length === 2)).toBe(true);
    const now = (await weatherNow()).getTime();
    const [grid] = await serviceDb().select().from(weather_snapshot).where(eq(weather_snapshot.source, 'nws_grid')).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    const one = lotWeather(grid!.summary, await latestModels(now), w.siteIds[0]!, now);
    expect(one.nbm).not.toBeNull();
    expect(one.nbm!.p10).toBeLessThanOrEqual(one.nbm!.p50);
    expect(one.nbm!.p50).toBeLessThanOrEqual(one.nbm!.p90);
  });

  it('a source that is down is skipped without tripping the NWS breaker, and the grid alone still decides', async () => {
    const real = await providers.getProviders();
    const spy = vi.spyOn(providers, 'getProviders').mockResolvedValue({ ...real, weather: Object.assign(Object.create(Object.getPrototypeOf(real.weather)), real.weather, { fetchNbm: async () => { throw new Error('NOMADS 503'); } }) });
    try {
      const breakerBefore = await providers.getSetting('weather_breaker');
      await setSetting('dev.clock', '2025-12-13T03:00:00Z');
      expect(await fetchModel('nbm')).toBeNull();
      expect(await providers.getSetting('weather_breaker')).toEqual(breakerBefore);
    } finally {
      spy.mockRestore();
      await setSetting('dev.clock', '2025-12-12T20:00:00Z');
    }
    // No run at all (a fresh install, or every source down): the lot's weather is the NWS grid as it was.
    const [grid] = await serviceDb().select().from(weather_snapshot).where(eq(weather_snapshot.source, 'nws_grid')).orderBy(desc(weather_snapshot.fetched_at)).limit(1);
    const bare = lotWeather(grid!.summary, {}, w.siteIds[0]!, Date.parse('2025-12-12T20:00:00Z'));
    expect(bare.nbm).toBeNull();
    expect(bare.radar).toBeNull();
    expect(bare.series.snowIn.length).toBeGreaterThan(0);
  });
});
