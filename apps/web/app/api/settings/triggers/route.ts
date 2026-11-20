import { eq, site } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { getSetting, setSetting } from '@/lib/providers';
import { saltSettings, saveSaltSettings } from '@/lib/salt-triggers';
import { triggerDefaultKey } from '@/lib/triggers';
import { areasKey } from '@/lib/weather';

const saltRule = z.object({ snow_in: z.number().min(0).max(48).nullable(), ice: z.boolean(), refreeze: z.boolean() });
const lotBody = z.object({ site_id: z.uuid(), area: z.string().trim().max(60).optional(), salt: saltRule.nullable().optional() });
const defaultBody = z.object({ inches: z.number().min(0).max(48).optional(), salt: saltRule.optional() });

/** A lot's service area (issue 198), blank going back to its city, and its salt run rule (issue 204), null for the company's. */
export const PATCH = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { site_id, area, salt } = await parseJson(req, lotBody);
  const [s] = await asUser(ctx, (tx) => tx.select({ id: site.id }).from(site).where(eq(site.id, site_id)));
  if (!s) throw new HttpError(404, 'Lot not found');
  if (area !== undefined) {
    const named = (await getSetting<Record<string, string>>(areasKey(ctx.tenantId))) ?? {};
    if (area) named[site_id] = area;
    else delete named[site_id];
    await setSetting(areasKey(ctx.tenantId), named);
  }
  if (salt !== undefined) {
    const now = await saltSettings(ctx.tenantId);
    if (salt) now.lots[site_id] = salt;
    else delete now.lots[site_id];
    await saveSaltSettings(ctx.tenantId, now);
  }
  return { ok: true };
});

/** The company's usual trigger, which new quotes start with, and its usual salt run rule. */
export const PUT = route(async (req) => {
  const ctx = await requireApi('owner');
  const { inches, salt } = await parseJson(req, defaultBody);
  if (inches === undefined && !salt) throw new HttpError(422, 'Nothing to save');
  if (inches !== undefined) await setSetting(triggerDefaultKey(ctx.tenantId), { inches });
  if (salt) await saveSaltSettings(ctx.tenantId, { ...(await saltSettings(ctx.tenantId)), default: salt });
  return { ok: true };
});
