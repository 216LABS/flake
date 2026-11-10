export type ServiceKind = 'plow' | 'salt' | 'walks' | 'haul';
export type SaltUnit = 'bag50lb' | 'lb' | 'ton' | 'application';

export type Pricing =
  | { type: 'per_push'; amount_cents: number }
  | { type: 'per_inch_tier'; tiers: { up_to_in: number | null; amount_cents: number }[] }
  | { type: 'per_event'; amount_cents: number }
  | { type: 'seasonal'; total_cents: number; installments: number }
  | { type: 'hourly'; rate_cents: number };

export interface ContractService {
  service: ServiceKind;
  trigger_in?: number | null;
  /** Absent for salt, which is priced from the contract's salt_pricing. */
  pricing?: Pricing | null;
}

export interface SaltPricing {
  unit: SaltUnit;
  amount_cents: number;
}

export interface SaltEntry {
  unit: string;
  qty: number;
}

export interface PricedVisit {
  id: string;
  site_id: string;
  services: string[];
  arrived_at: string;
  departed_at: string | null;
  depth_in: number | null;
  salt: SaltEntry[] | null;
  is_replow: boolean;
}

/** Each source may be unavailable. null is "unavailable", never zero. */
export interface StormDepthContext {
  nohrsc24hIn: number | null;
  nwsElapsedIn: number | null;
}

export interface InvoiceLine {
  site_id: string;
  service: string;
  pricing_type: Pricing['type'] | 'salt';
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  source_visit_ids: string[];
  needs_depth?: boolean;
}

/**
 * per_inch_tier depth = max(driver depth, observed total, NWS elapsed). null when all are unavailable. The caller only
 * passes an observed total whose window falls inside the storm, so snow from an earlier storm never sets the tier.
 */
export function stormDepthIn(driverDepths: (number | null)[], ctx: StormDepthContext): number | null {
  const known = [...driverDepths, ctx.nohrsc24hIn, ctx.nwsElapsedIn].filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
}

export function tierAmountCents(tiers: { up_to_in: number | null; amount_cents: number }[], depthIn: number): number {
  const sorted = [...tiers].sort((a, b) => (a.up_to_in ?? Infinity) - (b.up_to_in ?? Infinity));
  const hit = sorted.find((t) => t.up_to_in === null || depthIn <= t.up_to_in);
  return (hit ?? sorted[sorted.length - 1]!).amount_cents;
}

/** Rounded up to the next 15 minutes. */
export function billableQuarterHours(arrivedAt: string, departedAt: string | null): number {
  if (!departedAt) return 0;
  const minutes = Math.max(0, (Date.parse(departedAt) - Date.parse(arrivedAt)) / 60000);
  return Math.ceil(minutes / 15);
}

const LABEL: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };
const SALT_LABEL: Record<string, string> = { bag50lb: '50 lb bag', lb: 'lb', ton: 'ton', application: 'application' };

function line(
  visit: PricedVisit,
  svc: ContractService,
  type: Pricing['type'],
  quantity: number,
  unit: number,
  amount: number,
  detail: string,
): InvoiceLine {
  return {
    site_id: visit.site_id,
    service: svc.service,
    pricing_type: type,
    description: `${LABEL[svc.service]} ${detail}`,
    quantity,
    unit_amount_cents: unit,
    amount_cents: amount,
    source_visit_ids: [visit.id],
  };
}

/**
 * Prices one visit for one contract service. per_event and per_inch_tier return a line for each visit;
 * `priceSiteForStorm` collapses them to one charge per storm per site. seasonal returns nothing.
 */
export function priceVisit(svc: ContractService, visit: PricedVisit, depthIn: number | null): InvoiceLine[] {
  const p = svc.pricing;
  if (!p) return [];
  switch (p.type) {
    case 'per_push':
      return [line(visit, svc, 'per_push', 1, p.amount_cents, p.amount_cents, 'per push')];
    case 'per_event':
      return [line(visit, svc, 'per_event', 1, p.amount_cents, p.amount_cents, 'per event')];
    case 'per_inch_tier': {
      if (depthIn === null) {
        const l = line(visit, svc, 'per_inch_tier', 1, 0, 0, 'per inch tier, depth unavailable');
        return [{ ...l, needs_depth: true }];
      }
      const amount = tierAmountCents(p.tiers, depthIn);
      return [line(visit, svc, 'per_inch_tier', 1, amount, amount, `per inch tier at ${depthIn}"`)];
    }
    case 'seasonal':
      return [];
    case 'hourly': {
      const hours = billableQuarterHours(visit.arrived_at, visit.departed_at) / 4;
      return [line(visit, svc, 'hourly', hours, p.rate_cents, Math.round(p.rate_cents * hours), `hourly (${hours} h)`)];
    }
  }
}

/** Salt lines use the contract unit. A quantity logged in another unit is left unbilled and flagged by the engine. */
export function priceSalt(salt: SaltPricing | null | undefined, visit: PricedVisit): InvoiceLine[] {
  if (!salt || !visit.salt) return [];
  return visit.salt
    .filter((e) => e.unit === salt.unit && e.qty > 0)
    .map((e) => ({
      site_id: visit.site_id,
      service: 'salt',
      pricing_type: 'salt' as const,
      description: `Salt (${e.qty} x ${SALT_LABEL[e.unit] ?? e.unit})`,
      quantity: e.qty,
      unit_amount_cents: salt.amount_cents,
      amount_cents: Math.round(e.qty * salt.amount_cents),
      source_visit_ids: [visit.id],
    }));
}

/** All priced lines for one site in one storm, with per_event and per_inch_tier charged once per storm. */
export function priceSiteForStorm(
  services: ContractService[],
  salt: SaltPricing | null | undefined,
  visits: PricedVisit[],
  ctx: StormDepthContext,
): InvoiceLine[] {
  const depth = stormDepthIn(visits.map((v) => v.depth_in), ctx);
  const lines: InvoiceLine[] = [];
  for (const svc of services) {
    const relevant = visits.filter((v) => v.services.includes(svc.service));
    const priced = relevant.flatMap((v) => priceVisit(svc, v, depth));
    const once = svc.pricing?.type === 'per_event' || svc.pricing?.type === 'per_inch_tier';
    if (once && priced.length) {
      lines.push({ ...priced[0]!, source_visit_ids: priced.flatMap((l) => l.source_visit_ids) });
    } else {
      lines.push(...priced);
    }
  }
  // Only a visit where the driver turned Salt on bills salt. A quantity left on a visit with Salt off is not a sale.
  if (services.some((s) => s.service === 'salt')) {
    lines.push(...visits.filter((v) => v.services.includes('salt')).flatMap((v) => priceSalt(salt, v)));
  }
  return lines;
}

/** Equal installments in cents; the remainder goes on the first so the total always adds up exactly. */
export function seasonalInstallments(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const out = Array.from({ length: count }, () => base);
  out[0]! += totalCents - base * count;
  return out;
}
