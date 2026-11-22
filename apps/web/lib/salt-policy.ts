import type { SaltSurcharge } from '@flake/core/pricing';
import { app_setting, inArray, serviceDb } from '@flake/db';
import { getSetting, setSetting } from './providers';

/**
 * Salt policy for a tight season (issue 232): a surcharge on new bills, and rationing (priority areas only), company-wide
 * or for one storm. Stored as settings, so no schema change. Turning either on never touches an approved bill and
 * sends nothing by itself.
 */
export const RATION_AREAS = ['entrances', 'hills', 'walks', 'ada'] as const;
export type RationArea = (typeof RATION_AREAS)[number];
export const AREA_WORD: Record<RationArea, string> = { entrances: 'entrances', hills: 'hills', walks: 'walks', ada: 'accessible spaces' };
export const AREA_WORD_ES: Record<RationArea, string> = { entrances: 'entradas', hills: 'pendientes', walks: 'aceras', ada: 'espacios accesibles' };

const sKey = (t: string) => `salt_surcharge:${t}`;
export const surchargeFor = (tenantId: string) => getSetting<SaltSurcharge>(sKey(tenantId));
export const setSurcharge = (tenantId: string, s: SaltSurcharge | null) => setSetting(sKey(tenantId), s);

export interface Ration { on: boolean; since: string | null }
const rKey = (t: string) => `ration:${t}`;
const rStormKey = (t: string, stormId: string) => `ration:${t}:${stormId}`;
export const companyRation = async (tenantId: string): Promise<Ration> => (await getSetting<Ration>(rKey(tenantId))) ?? { on: false, since: null };
export const setCompanyRation = (tenantId: string, on: boolean) => setSetting(rKey(tenantId), { on, since: on ? new Date().toISOString() : null });
/** A storm's own setting wins; otherwise the company's. */
export async function stormRation(tenantId: string, stormId: string): Promise<Ration & { scope: 'storm' | 'company' }> {
  const own = await getSetting<Ration>(rStormKey(tenantId, stormId));
  if (own) return { ...own, scope: 'storm' };
  return { ...(await companyRation(tenantId)), scope: 'company' };
}
export const setStormRation = (tenantId: string, stormId: string, on: boolean) => setSetting(rStormKey(tenantId, stormId), { on, since: on ? new Date().toISOString() : null });

const aKey = (siteId: string) => `ration_areas:${siteId}`;
export const setRationAreas = (siteId: string, areas: RationArea[]) => setSetting(aKey(siteId), { areas: RATION_AREAS.filter((a) => areas.includes(a)) });
export async function rationAreas(siteIds: string[]): Promise<Map<string, RationArea[]>> {
  if (!siteIds.length) return new Map();
  const rows = await serviceDb().select().from(app_setting).where(inArray(app_setting.key, siteIds.map(aKey)));
  return new Map(rows.map((r) => [r.key.slice('ration_areas:'.length), ((r.value as { areas?: RationArea[] }).areas ?? [])]));
}

/**
 * For proof packets: rationing was the office's policy during this storm (issue 232), with the lot's priority areas,
 * so lighter salting reads as policy, not neglect. Company-wide rationing counts only if it was on before the storm ended.
 */
export async function rationNote(tenantId: string, s: { id: string; started_at: string; closed_at: string | null }, siteId: string): Promise<string | null> {
  const r = await stormRation(tenantId, s.id);
  if (!r.on || (r.scope === 'company' && r.since && r.since > (s.closed_at ?? new Date().toISOString()))) return null;
  const areas = (await rationAreas([siteId])).get(siteId) ?? [];
  return `Salt rationing was in effect (${r.scope === 'storm' ? 'set for this storm' : 'set company-wide'} by the office): salt on ${areas.length ? areas.map((a) => AREA_WORD[a]).join(', ') : 'priority areas'} only, at a reduced amount.`;
}
