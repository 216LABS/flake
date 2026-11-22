export type ServiceKind = 'plow' | 'salt' | 'walks' | 'haul';
export type SaltUnit = 'bag50lb' | 'lb' | 'ton' | 'application';

export type Pricing =
  /** season_min_cents: a seasonal minimum, trued up at season end for review (issue 233). */
  | { type: 'per_push'; amount_cents: number; season_min_cents?: number | null }
  /** depth_source: what decides the inches, named on the contract and the bill (issue 233). Driver depth by default. */
  | { type: 'per_inch_tier'; tiers: { up_to_in: number | null; amount_cents: number }[]; depth_source?: 'driver' | 'noaa' | null }
  | { type: 'per_event'; amount_cents: number }
  /** included_pushes and overage_cents: a seasonal price covers so many pushes, then each one more is billed (issue 233). */
  | { type: 'seasonal'; total_cents: number; installments: number; included_pushes?: number | null; overage_cents?: number | null }
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
  /** NOAA's observed snowfall analysis at the lot, over a window inside the storm. */
  nohrsc24hIn: number | null;
  /** The forecast added up over the storm. Kept for the dashboard and alerts; it never prices a bill. */
  nwsElapsedIn: number | null;
  /** The deepest a crew measured at another lot within 10 miles in the same storm. */
  nearbyDriverIn?: number | null;
}

/** Where a tier price's depth came from, so the bill can say it. */
export type DepthSource = 'site' | 'observed' | 'nearby';
const DEPTH_FROM: Record<DepthSource, string> = { site: 'measured on site', observed: 'NOAA observed', nearby: 'measured at a lot nearby' };

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
 * The depth a tier price uses, from evidence only: what the crew measured at this lot, else NOAA's observed total at
 * the lot, else what a crew measured at a lot within 10 miles in the same storm. A forecast is not evidence of what
 * fell, so it never sets a price; across the country a forecast can be off by inches (lake-effect bands, mountain
 * snow, the rain-snow line). null when there's no evidence, which the bill flags as depth missing. The caller only
 * passes an observed total whose window falls inside the storm, so snow from an earlier storm never sets the tier.
 */
export function stormDepth(driverDepths: (number | null)[], ctx: StormDepthContext, prefer: 'driver' | 'noaa' = 'driver'): { in: number; source: DepthSource } | null {
  // A contract that names NOAA's observed snowfall as the measure uses it first (issue 233), then the usual evidence.
  if (prefer === 'noaa' && ctx.nohrsc24hIn !== null) return { in: ctx.nohrsc24hIn, source: 'observed' };
  const site = driverDepths.filter((v): v is number => v !== null);
  if (site.length) return { in: Math.max(...site), source: 'site' };
  if (ctx.nohrsc24hIn !== null) return { in: ctx.nohrsc24hIn, source: 'observed' };
  if (ctx.nearbyDriverIn != null) return { in: ctx.nearbyDriverIn, source: 'nearby' };
  return null;
}

export const stormDepthIn = (driverDepths: (number | null)[], ctx: StormDepthContext): number | null => stormDepth(driverDepths, ctx)?.in ?? null;

/** Driver and NOAA this far apart is worth a look before a tier price goes out. */
export const DEPTH_DISAGREE_IN = 1.5;

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

/** Salt a driver logged, as a customer reads it: "3 bags (50 lb)", "1.5 tons", "200 lb", "1 application". */
export function saltAmountText(qty: number, unit: string): string {
  const one = Number(qty) === 1;
  switch (unit) {
    case 'bag50lb': return `${qty} ${one ? 'bag' : 'bags'} (50 lb)`;
    case 'ton': return `${qty} ${one ? 'ton' : 'tons'}`;
    case 'lb': return `${qty} lb`;
    case 'application': return `${qty} ${one ? 'application' : 'applications'}`;
    default: return `${qty} ${unit}`;
  }
}

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
export function priceVisit(svc: ContractService, visit: PricedVisit, depthIn: number | null, source?: DepthSource): InvoiceLine[] {
  const p = svc.pricing;
  if (!p) return [];
  switch (p.type) {
    case 'per_push':
      return [line(visit, svc, 'per_push', 1, p.amount_cents, p.amount_cents, 'per push')];
    case 'per_event':
      return [line(visit, svc, 'per_event', 1, p.amount_cents, p.amount_cents, 'per event')];
    case 'per_inch_tier': {
      if (depthIn === null) {
        const l = line(visit, svc, 'per_inch_tier', 1, 0, 0, 'by snow depth, depth not recorded');
        return [{ ...l, needs_depth: true }];
      }
      const amount = tierAmountCents(p.tiers, depthIn);
      return [line(visit, svc, 'per_inch_tier', 1, amount, amount, `for ${depthIn}" of snow${source ? `, ${DEPTH_FROM[source]}` : ''}`)];
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
  /** Pushes this lot already had this season before this storm, for a seasonal cap (issue 233). */
  opts: { pushesBefore?: number } = {},
): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  for (const svc of services) {
    const p = svc.pricing;
    const depth = stormDepth(visits.map((v) => v.depth_in), ctx, p?.type === 'per_inch_tier' && p.depth_source === 'noaa' ? 'noaa' : 'driver');
    const relevant = visits.filter((v) => v.services.includes(svc.service));
    if (p?.type === 'seasonal' && p.included_pushes != null && p.overage_cents) {
      const cap = p.included_pushes;
      const before = opts.pushesBefore ?? 0;
      [...relevant].sort((a, b) => a.arrived_at.localeCompare(b.arrived_at)).forEach((v, i) => {
        const n = before + i + 1;
        if (n > cap) lines.push(line(v, svc, 'seasonal', 1, p.overage_cents!, p.overage_cents!, `push ${n} of the season, past the ${cap} included`));
      });
      continue;
    }
    const priced = relevant.flatMap((v) => priceVisit(svc, v, depth?.in ?? null, depth?.source));
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
/**
 * What is left to bill on a seasonal price once earlier agreements for the same lot and season billed some of it
 * (issues 112, 156): the rest of the total over the installments left, and at least one if the count is used up but
 * money is still owed. Empty once the total is covered.
 */
export function seasonalRemaining(totalCents: number, installments: number, prior: { cents: number; count: number }): number[] {
  const left = Math.max(0, totalCents - prior.cents);
  if (left <= 0) return [];
  return seasonalInstallments(left, Math.max(1, installments - prior.count));
}

export function seasonalInstallments(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const out = Array.from({ length: count }, () => base);
  out[0]! += totalCents - base * count;
  return out;
}

/**
 * A salt surcharge on top of contract prices (issue 232): salt bought at spot prices this season. Priced from the salt
 * the driver recorded on each visit, per ton, per 50 lb bag, or flat per salted visit, for visits on or after `from`
 * (and on or before `until`), in the company's local days.
 */
export interface SaltSurcharge { per: 'ton' | 'bag50lb' | 'application'; amount_cents: number; from: string; until?: string | null }

const TONS_PER: Record<string, number> = { ton: 1, bag50lb: 0.025, lb: 0.0005 };
const localDate = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const PER_WORD: Record<SaltSurcharge['per'], string> = { ton: 'ton', bag50lb: '50 lb bag', application: 'salting' };

export function surchargeLines(salted: InvoiceLine[], visits: PricedVisit[], s: SaltSurcharge | null | undefined, tz: string): InvoiceLine[] {
  if (!s || s.amount_cents <= 0) return [];
  const out: InvoiceLine[] = [];
  for (const line of salted.filter((l) => l.service === 'salt' && l.pricing_type === 'salt')) {
    const v = visits.find((x) => x.id === line.source_visit_ids[0]);
    if (!v) continue;
    const day = localDate(v.departed_at ?? v.arrived_at, tz);
    if (day < s.from || (s.until && day > s.until)) continue;
    const entry = (v.salt ?? []).find((e) => e.qty === line.quantity) ?? (v.salt ?? [])[0];
    const tons = entry && TONS_PER[entry.unit] !== undefined ? line.quantity * TONS_PER[entry.unit]! : null;
    // Per ton or per bag needs a weight; a salting priced "per application" has none, so it isn't surcharged by weight.
    const qty = s.per === 'application' ? 1 : tons === null ? null : s.per === 'ton' ? tons : tons / TONS_PER.bag50lb!;
    if (qty === null || qty <= 0) continue;
    const q = Math.round(qty * 1000) / 1000;
    out.push({
      site_id: line.site_id, service: 'salt_surcharge', pricing_type: 'salt',
      description: `Salt surcharge (${q} x ${PER_WORD[s.per]}), for this season's salt prices`,
      quantity: q, unit_amount_cents: s.amount_cents, amount_cents: Math.round(q * s.amount_cents), source_visit_ids: line.source_visit_ids,
    });
  }
  return out;
}
