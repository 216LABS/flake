import { eq, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { getSetting, setSetting } from '@/lib/providers';
import { triggerDefaultKey } from '@/lib/triggers';
import { areasKey } from '@/lib/weather';

const areaBody = z.object({ site_id: z.uuid(), area: z.string().trim().max(60) });
const defaultBody = z.object({ inches: z.number().min(0).max(48) });

/** A lot's service area (issue 198). Blank goes back to its city. */
export const PATCH = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { site_id, area } = await parseJson(req, areaBody);
  const [s] = await asUser(ctx, (tx) => tx.select({ id: site.id }).from(site).where(eq(site.id, site_id)));
  if (!s) throw new HttpError(404, 'Lot not found');
  const named = (await getSetting<Record<string, string>>(areasKey(ctx.tenantId))) ?? {};
  if (area) named[site_id] = area;
  else delete named[site_id];
  await setSetting(areasKey(ctx.tenantId), named);
  return { ok: true };
});

/** The company's usual trigger, which new quotes start with. */
export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const { inches } = await parseJson(req, defaultBody);
  await setSetting(triggerDefaultKey(ctx.tenantId), { inches });
  return { ok: true };
});
