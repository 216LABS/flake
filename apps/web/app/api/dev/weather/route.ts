import { z } from 'zod';
import { WEATHER_FIXTURES } from '@flake/providers';
import { serviceDb, site, eq, sql } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { isProd } from '@/lib/env';
import { HttpError, parseJson, route } from '@/lib/http';
import { setSetting, weatherNow } from '@/lib/providers';
import { evaluateTenant, fetchAlerts, fetchCell, fetchNohrsc, mapSites, tenantWeatherHeader } from '@/lib/weather';

const body = z.object({
  fixture: z.enum(Object.keys(WEATHER_FIXTURES) as [keyof typeof WEATHER_FIXTURES, ...(keyof typeof WEATHER_FIXTURES)[]]).optional(),
  clock: z.string().optional(),
  advanceHours: z.number().optional(),
  poll: z.boolean().optional(),
});

/** /dev/weather: choose a synthetic fixture, move the fake clock, and run one poll right away. */
export const POST = route(async (req) => {
  if (isProd()) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const b = await parseJson(req, body);
  if (b.fixture) {
    await setSetting('dev.weather_fixture', b.fixture);
    await setSetting('dev.clock', WEATHER_FIXTURES[b.fixture].startAt);
  }
  if (b.clock) await setSetting('dev.clock', new Date(b.clock).toISOString());
  if (b.advanceHours) await setSetting('dev.clock', new Date((await weatherNow()).getTime() + b.advanceHours * 3600000).toISOString());
  let created: string[] = [];
  if (b.poll) {
    await mapSites(ctx.tenantId);
    const cells = await serviceDb().selectDistinct({ office: site.nws_office, x: site.nws_grid_x, y: site.nws_grid_y }).from(site).where(sql`${eq(site.tenant_id, ctx.tenantId)} and ${site.nws_office} is not null`);
    for (const c of cells) await fetchCell(c.office!, c.x!, c.y!);
    await fetchAlerts(ctx.tenantId);
    await fetchNohrsc(24);
    created = await evaluateTenant(ctx.tenantId);
    

  }
  return { clock: (await weatherNow()).toISOString(), created, header: await tenantWeatherHeader(ctx.tenantId) };
});
