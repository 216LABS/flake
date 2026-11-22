import { z } from 'zod';
import { and, eq, serviceDb, site, storm } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { RATION_AREAS, setCompanyRation, setRationAreas, setStormRation, setSurcharge } from '@/lib/salt-policy';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('surcharge'), surcharge: z.object({ per: z.enum(['ton', 'bag50lb', 'application']), amount_cents: z.number().int().min(1).max(100_000), from: day, until: day.nullable().optional() }).nullable() }),
  z.object({ action: z.literal('ration'), on: z.boolean(), storm_id: z.uuid().optional() }),
  z.object({ action: z.literal('areas'), site_id: z.uuid(), areas: z.array(z.enum(RATION_AREAS)).max(4) }),
]);

/** Salt policy (issue 232): the surcharge, rationing company-wide or for one storm, and each lot's priority areas. */
export const PUT = route(async (req) => {
  const b = await parseJson(req, body);
  const db = serviceDb();
  if (b.action === 'surcharge') {
    const ctx = await requireApi('owner');
    if (b.surcharge?.until && b.surcharge.until < b.surcharge.from) throw new HttpError(422, 'The end date is before the start date.');
    await setSurcharge(ctx.tenantId, b.surcharge);
    return { surcharge: b.surcharge };
  }
  const ctx = await requireApi('dispatcher');
  if (b.action === 'ration') {
    if (b.storm_id) {
      const [s] = await db.select({ id: storm.id }).from(storm).where(and(eq(storm.id, b.storm_id), eq(storm.tenant_id, ctx.tenantId)));
      if (!s) throw new HttpError(404, 'Storm not found');
      await setStormRation(ctx.tenantId, b.storm_id, b.on);
    } else await setCompanyRation(ctx.tenantId, b.on);
    return { on: b.on };
  }
  const [st] = await db.select({ id: site.id }).from(site).where(and(eq(site.id, b.site_id), eq(site.tenant_id, ctx.tenantId)));
  if (!st) throw new HttpError(404, 'Lot not found');
  await setRationAreas(b.site_id, b.areas);
  return { areas: b.areas };
});
