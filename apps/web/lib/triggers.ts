import { evaluateSite, summarize, triggerLine, type SaltTrigger } from '@flake/core/trigger';
import type { ContractService } from '@flake/core/pricing';
import { liveContracts } from '@flake/core/time';
import { and, contract, desc, eq, serviceDb, site, tenant } from '@flake/db';
import { getSetting, weatherNow } from './providers';
import { saltSettings } from './salt-triggers';
import { areasFor, latestGrids, latestModels, lotWeather, triggerInputs } from './weather';

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
  /** Salt in the contract, and the rule for its salt runs (issue 204): its own, or the company's. */
  has_salt: boolean;
  salt_rule: SaltTrigger;
  salt_custom: boolean;
  /** What this lot would get from the forecast right now: plow, salt, or no trigger, and why. */
  now: { plow: boolean; salt: boolean; text: string };
  /** The Blend of models' 10th to 90th percentile for the next 12 hours (issue 203). */
  range_in: [number, number] | null;
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
  const inputs = await triggerInputs(t, sites, now);
  const models = await latestModels(now);
  const salt = await saltSettings(tenantId);
  return sites.map((s) => {
    const k = live.find((c) => c.site_id === s.id);
    const services = (k?.services ?? []) as ContractService[];
    const triggers = services.map((x) => x.trigger_in).filter((x): x is number => typeof x === 'number');
    const snap = latest.get(`${s.nws_office}/${s.nws_grid_x}/${s.nws_grid_y}`);
    const w = snap ? lotWeather(snap.summary, models, s.id, now) : null;
    const series = w?.series ?? null;
    const input = inputs.get(s.id);
    return {
      has_salt: services.some((x) => x.service === 'salt'),
      salt_rule: salt.lots[s.id] ?? salt.default,
      salt_custom: Boolean(salt.lots[s.id]),
      now: series && input ? triggerLine(evaluateSite(input, series, now, [], { nbm: w!.nbm })) : { plow: false, salt: false, text: 'No trigger' },
      range_in: w?.nbm ? [w.nbm.p10, w.nbm.p90] : null,
      id: s.id, label: s.label, address: s.address, area: areaOf.get(s.id) ?? 'Your area',
      trigger_in: triggers.length ? Math.min(...triggers) : null,
      services: services.map((x) => x.service),
      contract: k ? 'signed' : all.some((c) => c.site_id === s.id && (c.status === 'sent' || c.status === 'draft')) ? 'waiting' : 'none',
      forecast_in: series ? summarize(series, now).snow_next12h_in : null,
    };
  });
}
