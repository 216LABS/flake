import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, closeDb, contract, eq, inArray, serviceDb, site, trigger_alert, weather_snapshot } from '@flake/db';
import { setSetting } from '@/lib/providers';
import { saltTriggerKey } from '@/lib/salt-triggers';
import { triggerTable } from '@/lib/triggers';
import { areasKey, areaWeather, evaluateTenant } from '@/lib/weather';
import { makeWorld, type World } from './helpers';

afterAll(() => closeDb());

const H = 3600000;
// The date the other weather tests use, so the shared fake clock is left where they expect it.
const NOW = Date.parse('2025-12-12T20:00:00Z');
const hours = (vals: number[]) => vals.map((v, i) => [NOW + i * H, v]);

/**
 * Issue 204, end to end: Cleveland gets 3" (plow, and salt on the plow alert), Akron half an inch and freezing rain
 * (a salt run for its salt lots only), Medina nothing. Each area has its own forecast cell, as in real life.
 */
describe('salt runs by service area', () => {
  let w: World;
  const cell = { Cleveland: 901, Akron: 902, Medina: 903 } as const;
  beforeAll(async () => {
    w = await makeWorld();
    await setSetting('dev.clock', new Date(NOW).toISOString());
    const db = serviceDb();
    // Site 0 Cleveland plow + salt, 1 Cleveland plow, 2 Akron plow + salt, 3 Akron salt only, 4 Medina plow + salt.
    const plan: [keyof typeof cell, string[]][] = [['Cleveland', ['plow', 'salt']], ['Cleveland', ['plow']], ['Akron', ['plow', 'salt']], ['Akron', ['salt']], ['Medina', ['plow', 'salt']]];
    for (const [i, [area, services]] of plan.entries()) {
      const id = w.siteIds[i]!;
      await db.update(site).set({ nws_office: 'TST', nws_grid_x: cell[area], nws_grid_y: 1 }).where(eq(site.id, id));
      await db.update(contract).set({ services: services.map((s) => (s === 'plow' ? { service: 'plow', trigger_in: 2, pricing: { type: 'per_push', amount_cents: 6500 } } : { service: 'salt', pricing: { type: 'per_application', amount_cents: 4000 } })) as never }).where(eq(contract.site_id, id));
    }
    await setSetting(areasKey(w.tenantId), Object.fromEntries(plan.map(([area], i) => [w.siteIds[i]!, area])));
    const forecasts = {
      Cleveland: { snow: hours([1, 1, 1]), ice: hours([0, 0, 0]), temp: hours([28, 28, 28]) },
      Akron: { snow: hours([0.25, 0.25]), ice: hours([0, 0.05]), temp: hours([31, 30]) },
      Medina: { snow: hours([0, 0, 0]), ice: hours([0, 0, 0]), temp: hours([38, 38, 38]) },
    };
    for (const [area, hourly] of Object.entries(forecasts)) {
      await db.insert(weather_snapshot).values({ source: 'nws_grid', office: 'TST', grid_x: cell[area as keyof typeof cell], grid_y: 1, fetched_at: new Date(NOW).toISOString(), request_url: `mock://salt-runs/${area}`, storage_path: 'test/none', sha256: 'test', summary: { hourly } });
    }
  });

  it('Cleveland gets a plow alert, Akron a salt run for its salt lots only, Medina neither', async () => {
    await evaluateTenant(w.tenantId);
    const rows = await serviceDb().select().from(trigger_alert).where(and(eq(trigger_alert.tenant_id, w.tenantId), inArray(trigger_alert.kind, ['forecast', 'salt_run', 'depth_report'])));
    const got = rows.map((r) => [r.kind, r.detail.area, [...r.site_ids].sort()]).sort();
    expect(got).toEqual([
      ['forecast', 'Cleveland', [w.siteIds[0], w.siteIds[1]].sort()],
      ['salt_run', 'Akron', [w.siteIds[2], w.siteIds[3]].sort()],
    ].sort());
    const salt = rows.find((r) => r.kind === 'salt_run')!;
    expect(salt.detail.headline).toMatch(/^Akron: 0\.5" \+ freezing rain by .+, salt only\. 2 salt lots\.$/);
    expect(rows.find((r) => r.kind === 'forecast')!.detail.headline).toMatch(/^Cleveland: 3" forecast .*, plow, 1 with salt\.$/);
    expect(rows.flatMap((r) => r.site_ids)).not.toContain(w.siteIds[4]);
  });

  it('the dashboard says plow vs salt vs no trigger for each area', async () => {
    const lines = Object.fromEntries((await areaWeather(w.tenantId)).map((a) => [a.area, a.trigger.text]));
    expect(lines.Cleveland).toBe('3" forecast, plow + salt');
    expect(lines.Akron).toBe('0.5" + freezing rain, salt only');
    expect(lines.Medina).toBe('No trigger');
  });

  it('the triggers table shows each lot the same way, and a lot can change its salt rule', async () => {
    const table = await triggerTable(w.tenantId);
    const row = (i: number) => table.find((r) => r.id === w.siteIds[i])!;
    expect(row(1).now.text).toBe('3" forecast, plow');
    expect(row(3).now).toMatchObject({ plow: false, salt: true, text: '0.5" + freezing rain, salt only' });
    expect(row(4).now.text).toBe('No trigger');
    expect(row(3).salt_custom).toBe(false);
    // Akron's salt-only lot set to ice and refreeze only: the freezing rain still calls for it.
    await setSetting(saltTriggerKey(w.tenantId), { lots: { [w.siteIds[3]!]: { snow_in: null, ice: true, refreeze: true } } });
    const after = (await triggerTable(w.tenantId)).find((r) => r.id === w.siteIds[3])!;
    expect(after.salt_custom).toBe(true);
    expect(after.now.text).toBe('Freezing rain, salt only');
  });
});
