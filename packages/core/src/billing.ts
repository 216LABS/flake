import type { MultiPolygon, Polygon } from 'geojson';
import { distanceMeters, distanceToPolygonMeters, gpsMatches } from './geo';
import { usDistanceText } from './units';
import { priceSiteForStorm, type ContractService, type InvoiceLine, type PricedVisit, type SaltPricing, type StormDepthContext } from './pricing';

export const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

export type FlagCode =
  | 'missing_visit'
  | 'duplicate'
  | 'no_gps_match'
  | 'no_after_photo'
  | 'missing_salt_qty'
  | 'seasonal_info'
  | 'missing_depth'
  | 'no_contract'
  | 'odd_duration'
  | 'no_service'
  | 'salt_unit';

/**
 * How much a flag matters at a dawn billing review (issue 78): money at risk first, then missing proof, then lots
 * nobody reached. Info isn't a problem.
 */
export type FlagTier = 'money' | 'proof' | 'not_done' | 'info';
export const FLAG_TIER: Record<FlagCode, FlagTier> = {
  no_contract: 'money', no_service: 'money', missing_salt_qty: 'money', salt_unit: 'money', missing_depth: 'money', duplicate: 'money', odd_duration: 'money',
  no_after_photo: 'proof', no_gps_match: 'proof',
  missing_visit: 'not_done',
  seasonal_info: 'info',
};
export const TIER_ORDER: FlagTier[] = ['money', 'proof', 'not_done', 'info'];

/** Each flag in the few words a billing summary line uses. */
const TIER_REASON: Record<FlagCode, string> = {
  no_contract: 'no price', no_service: 'nothing ticked', missing_salt_qty: 'salt missing', salt_unit: 'salt missing',
  missing_depth: 'depth missing', duplicate: 'a possible duplicate', odd_duration: 'an odd time on site',
  no_after_photo: 'no after photo', no_gps_match: 'no or far-off location',
  missing_visit: 'not reached', seasonal_info: 'seasonal',
};

/**
 * The reasons behind one tier's count, naming only the flags actually there, so a bill missing only its location
 * doesn't read as missing a photo too (issue 75 retest).
 */
export function tierReasons(tier: FlagTier, codes: Iterable<FlagCode>): string {
  const seen = new Set<string>();
  for (const c of codes) if (FLAG_TIER[c] === tier) seen.add(TIER_REASON[c]);
  return [...seen].join(', ');
}

export interface BillingFlag {
  code: FlagCode;
  site_id: string;
  visit_id?: string;
  message: string;
  severity: 'review' | 'info';
  waived?: boolean;
  /** For salt flags: the unit the contract prices salt in, so a fix is entered in that unit. */
  unit?: string;
  /** For no_service: the contract's priced services, which a fix can add to the visit. */
  services?: string[];
}

export interface BillingSite {
  id: string;
  customer_id: string;
  label: string;
  lat: number;
  lon: number;
  polygons?: Polygon | MultiPolygon | null;
}

export interface BillingContract {
  site_id: string;
  services: ContractService[];
  salt_pricing?: SaltPricing | null;
}

export interface BillingVisit extends PricedVisit {
  arrive_lat: number | null;
  arrive_lon: number | null;
  after_photos: number;
}

export interface VisitCorrection {
  visit_id: string;
  field: string;
  new_value: unknown;
}

export interface DraftInvoice {
  customer_id: string;
  lines: InvoiceLine[];
  subtotal_cents: number;
  flags: BillingFlag[];
}

export interface DraftInput {
  sites: BillingSite[];
  contracts: BillingContract[];
  stops: { site_id: string; status: string }[];
  visits: BillingVisit[];
  corrections: VisitCorrection[];
  depth: Record<string, StormDepthContext>;
  /** Flag keys the owner already waived for this storm. */
  waived?: string[];
}

export const flagKey = (f: Pick<BillingFlag, 'code' | 'site_id' | 'visit_id'>) => `${f.code}:${f.site_id}:${f.visit_id ?? ''}`;

const CORRECTABLE = new Set(['salt', 'is_replow', 'services', 'depth_in']);

/** Rows stay append-only. Effective values are computed by replaying corrections oldest-first. */
export function applyCorrections(visits: BillingVisit[], corrections: VisitCorrection[]): BillingVisit[] {
  const voided = new Set(corrections.filter((c) => c.field === 'voided' && c.new_value === true).map((c) => c.visit_id));
  return visits
    .filter((v) => !voided.has(v.id))
    .map((v) => {
      const patch = corrections.filter((c) => c.visit_id === v.id && CORRECTABLE.has(c.field));
      return patch.reduce((acc, c) => ({ ...acc, [c.field]: c.new_value }), v);
    });
}

/** Longer than this on one hourly lot is unusual enough for a person to look before it bills. */
const LONG_VISIT_MINUTES = 4 * 60;

function flagsForSite(site: BillingSite, contract: BillingContract | undefined, statuses: string[], visits: BillingVisit[]): BillingFlag[] {
  const flags: BillingFlag[] = [];
  const add = (code: FlagCode, message: string, visit_id?: string, severity: BillingFlag['severity'] = 'review', extra: Pick<BillingFlag, 'unit' | 'services'> = {}) =>
    flags.push({ code, site_id: site.id, message, severity, ...(visit_id ? { visit_id } : {}), ...extra });
  const saltUnit = contract?.salt_pricing?.unit;

  if (!visits.length && statuses.some((s) => s !== 'skipped')) {
    add('missing_visit', `${site.label} was in this storm's runs but has no completed visit.`);
  }
  const sorted = [...visits].sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
  sorted.forEach((v, i) => {
    const prev = sorted[i - 1];
    if (prev && !v.is_replow && Date.parse(v.arrived_at) - Date.parse(prev.arrived_at) < DUPLICATE_WINDOW_MS) {
      add('duplicate', `${site.label} has two done visits under 60 minutes apart. Mark as re-plow if both are real.`, v.id);
    }
    // No location at all and a location in the wrong place are different problems (issue 78).
    if (v.arrive_lat == null || v.arrive_lon == null) {
      add('no_gps_match', `${site.label}: the phone didn't share its location on arrival, so there's no GPS record of this visit.`, v.id);
    } else if (!gpsMatches(v.arrive_lat, v.arrive_lon, site)) {
      const m = site.polygons ? distanceToPolygonMeters(v.arrive_lat, v.arrive_lon, site.polygons) : distanceMeters(v.arrive_lat, v.arrive_lon, site.lat, site.lon);
      add('no_gps_match', `${site.label}: the phone was about ${usDistanceText(m)} from the lot on arrival.`, v.id);
    }
    // Hourly lots bill straight from the phone's Arrive and Done times, so a Done tapped at the end of a shift, or a
    // phone clock that jumped, would bill hours nobody worked.
    const minutes = (Date.parse(v.departed_at!) - Date.parse(v.arrived_at)) / 60000; // only done visits reach here
    if (minutes < 0) {
      add('odd_duration', `${site.label}: Done is earlier than Arrive on the phone's clock, so the time on site is unknown.`, v.id);
    } else if (minutes > LONG_VISIT_MINUTES && contract?.services.some((s) => s.pricing?.type === 'hourly')) {
      add('odd_duration', `${site.label}: ${Math.round(minutes / 6) / 10} h on site at an hourly rate. Check Done wasn't tapped late.`, v.id);
    }
    if (v.after_photos === 0) add('no_after_photo', `${site.label}: no after photo on this visit.`, v.id);
    if (v.services.includes('salt') && !v.salt?.some((e) => e.qty > 0)) {
      add('missing_salt_qty', `${site.label}: salt service logged with no quantity.`, v.id, 'review', saltUnit ? { unit: saltUnit } : {});
    }
    // Salt logged in bags on a per-ton contract (or the other way) can't be priced, so it would go out free.
    const odd = v.services.includes('salt') && saltUnit ? (v.salt ?? []).filter((e) => e.qty > 0 && e.unit !== saltUnit) : [];
    if (odd.length) {
      add('salt_unit', `${site.label}: salt logged as ${odd.map((e) => `${e.qty} ${e.unit}`).join(', ')}, but the contract prices salt per ${saltUnit}. Enter the quantity in ${saltUnit} to bill it.`, v.id, 'review', { unit: saltUnit });
    }
    // A finished visit with none of the contract's services on it prices at $0. Say so instead of a silent zero.
    const priced = (contract?.services ?? []).filter((s) => s.pricing && s.pricing.type !== 'seasonal').map((s) => s.service as string);
    if (priced.length && !v.services.some((x) => priced.includes(x)) && !(v.services.includes('salt') && contract?.services.some((s) => s.service === 'salt'))) {
      add('no_service', `${site.label}: the driver finished this visit with no service ticked (${priced.join(', ')} on the contract), so nothing was billed for it.`, v.id, 'review', { services: priced });
    }
  });
  if (!contract) {
    if (visits.length) add('no_contract', `${site.label} has visits but no accepted contract, so nothing was priced.`);
  } else if (contract.services.some((s) => s.pricing?.type === 'seasonal')) {
    add('seasonal_info', `${site.label} is on a seasonal contract. No per-visit charge.`, undefined, 'info');
  }
  return flags;
}

/** One draft per customer with priced lines and flags. A draft with only info or waived flags is clean. */
export function draftInvoices(input: DraftInput): DraftInvoice[] {
  const waived = new Set(input.waived ?? []);
  const effective = applyCorrections(input.visits, input.corrections).filter((v) => v.departed_at !== null);
  const byCustomer = new Map<string, DraftInvoice>();

  for (const site of input.sites) {
    const statuses = input.stops.filter((s) => s.site_id === site.id).map((s) => s.status);
    const visits = effective.filter((v) => v.site_id === site.id);
    if (!statuses.length && !visits.length) continue;
    const contract = input.contracts.find((c) => c.site_id === site.id);
    const lines = contract
      ? priceSiteForStorm(contract.services, contract.salt_pricing, visits, input.depth[site.id] ?? { nohrsc24hIn: null, nwsElapsedIn: null })
      : [];
    const flags = flagsForSite(site, contract, statuses, visits);
    for (const l of lines) {
      if (l.needs_depth) {
        flags.push({ code: 'missing_depth', site_id: site.id, severity: 'review', message: `${site.label}: storm depth is unavailable, so the tier price could not be set.` });
      }
    }
    const draft = byCustomer.get(site.customer_id) ?? { customer_id: site.customer_id, lines: [], subtotal_cents: 0, flags: [] };
    draft.lines.push(...lines);
    draft.subtotal_cents += lines.reduce((sum, l) => sum + l.amount_cents, 0);
    draft.flags.push(...flags.map((f) => (waived.has(flagKey(f)) ? { ...f, waived: true } : f)));
    byCustomer.set(site.customer_id, draft);
  }
  return [...byCustomer.values()];
}

export function isDraftClean(flags: BillingFlag[]): boolean {
  return flags.every((f) => f.severity === 'info' || f.waived === true);
}
