import { DEFAULT_SALT_TRIGGER, type SaltTrigger } from '@flake/core/trigger';
import { getSetting, setSetting } from './providers';

/**
 * When salt lots get a salt run (issue 204): a company default, and per-lot changes. Kept in settings like service
 * areas, so it needs no table.
 */
export const saltTriggerKey = (tenantId: string) => `salt_trigger:${tenantId}`;
export interface SaltSettings { default: SaltTrigger; lots: Record<string, SaltTrigger> }

const clean = (v: unknown): SaltTrigger | null => {
  const o = v as Partial<SaltTrigger> | null;
  if (!o || typeof o !== 'object') return null;
  return { snow_in: typeof o.snow_in === 'number' ? o.snow_in : null, ice: o.ice !== false, refreeze: o.refreeze !== false };
};

export async function saltSettings(tenantId: string): Promise<SaltSettings> {
  const v = await getSetting<{ default?: unknown; lots?: Record<string, unknown> }>(saltTriggerKey(tenantId));
  const lots: Record<string, SaltTrigger> = {};
  for (const [id, rule] of Object.entries(v?.lots ?? {})) {
    const r = clean(rule);
    if (r) lots[id] = r;
  }
  return { default: clean(v?.default) ?? DEFAULT_SALT_TRIGGER, lots };
}

export async function saveSaltSettings(tenantId: string, s: SaltSettings) {
  await setSetting(saltTriggerKey(tenantId), s);
}

/** A lot's rule: its own, or the company's. */
export const saltRuleFor = (s: SaltSettings, siteId: string): SaltTrigger => s.lots[siteId] ?? s.default;
