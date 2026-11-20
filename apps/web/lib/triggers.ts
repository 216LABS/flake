import { summarize } from '@flake/core/trigger';
import type { ContractService } from '@flake/core/pricing';
import { liveContracts } from '@flake/core/time';
import { and, contract, desc, eq, serviceDb, site, tenant } from '@flake/db';
import { getSetting, weatherNow } from './providers';
import { areasFor, latestGrids, seriesFromSummary } from './weather';

/** The company's usual trigger depth, used to fill in new quotes (issue 198). */
export const triggerDefaultKey = (tenantId: string) => `trigger_default:${tenantId}`;
export async function defaultTrigger(tenantId: string): Promise<number> {
  const v = await getSetting<{ inches: number }>(triggerDefaultKey(tenantId));
  return typeof v?.inches === 'number' ? v.inches : 2;
}

export interface TriggerRow {
  id: string; label: string; address: string; area: string;
  trigger_in: number | null; services: string[];
  contract: 'signed' | 'waiting' | 'none';
  forecast_in: number | null;
}

/**
 * Every lot's trigger and today's forecast against it, in one table (issue 198). A lot with no signed contract never
 * triggers, and says so.
 */
export async function triggerTable(tenantId: string): Promise<TriggerRow[]> {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.active, true))).orderBy(site.label);
  if (!t || !sites.length) return [];
  const all = await db.select().from(contract).where(eq(contract.tenant_id, tenantId)).orderBy(desc(contract.created_at));
  const live = liveContracts(all.filter((c) => c.status === 'accepted'), new Date(), t.timezone);
  const areaOf = await areasFor(tenantId, sites);
  const latest = await latestGrids(sites.map((s) => ({ office: s.nws_office, x: s.nws_grid_x, y: s.nws_grid_y })));
  const now = (await weatherNow()).getTime();
  return sites.map((s) => {
    const k = live.find((c) => c.site_id === s.id);
    const services = (k?.services ?? []) as ContractService[];
    const triggers = services.map((x) => x.trigger_in).filter((x): x is number => typeof x === 'number');
    const snap = latest.get(`${s.nws_office}/${s.nws_grid_x}/${s.nws_grid_y}`);
    return {
      id: s.id, label: s.label, address: s.address, area: areaOf.get(s.id) ?? 'Your area',
      trigger_in: triggers.length ? Math.min(...triggers) : null,
      services: services.map((x) => x.service),
      contract: k ? 'signed' : all.some((c) => c.site_id === s.id && (c.status === 'sent' || c.status === 'draft')) ? 'waiting' : 'none',
      forecast_in: snap ? summarize(seriesFromSummary(snap.summary), now).snow_next12h_in : null,
    };
  });
}
