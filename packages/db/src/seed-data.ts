/**
 * The demo tenant from ADDENDUM_DEVOPS section 2. A clearly fake company with fake names and 555-01xx numbers.
 * Coordinates are street-level points with generic labels: no real business names, no real homeowners.
 */
export type SeedPricing =
  | { type: 'per_push'; amount_cents: number }
  | { type: 'per_inch_tier'; tiers: { up_to_in: number | null; amount_cents: number }[] }
  | { type: 'per_event'; amount_cents: number }
  | { type: 'seasonal'; total_cents: number; installments: number }
  | { type: 'hourly'; rate_cents: number };

export interface SeedSite {
  key: string;
  label: string;
  street: string;
  city: string;
  lat: number;
  lon: number;
  kind: 'residential' | 'commercial' | 'hoa';
  route: 'west' | 'east' | 'river';
  trigger: number;
  pricing: SeedPricing;
  salt: boolean;
  billing: 'card_on_file' | 'ach_on_file' | 'invoice_net30' | 'manual';
  pm?: string;
  priority?: number;
  open_by?: string;
}

const tiers = (a: number, b: number, c: number) => ({ type: 'per_inch_tier' as const, tiers: [{ up_to_in: 4, amount_cents: a }, { up_to_in: 8, amount_cents: b }, { up_to_in: null, amount_cents: c }] });
const res = (key: string, street: string, city: string, lat: number, lon: number, route: SeedSite['route'], cents: number, pm = 'pm_mock_4242'): SeedSite => ({ key, label: `Residential - ${street}`, street, city, lat, lon, kind: 'residential', route, trigger: 2, pricing: { type: 'per_push', amount_cents: cents }, salt: false, billing: 'card_on_file', pm });

export const SEED_SITES: SeedSite[] = [
  // 8 residential driveways, per push $45 to $65, 2" trigger.
  res('r1', 'Bunts Rd #12', 'Lakewood', 41.4772, -81.7905, 'west', 5500),
  res('r2', 'Bunts Rd #48', 'Lakewood', 41.4741, -81.7906, 'west', 4500),
  res('r3', 'Hilliard Rd #210', 'Lakewood', 41.4695, -81.7988, 'west', 6000),
  res('r4', 'Lakewood Ave #77', 'Lakewood', 41.4838, -81.7872, 'east', 5000),
  res('r5', 'Clarence Ave #1404', 'Lakewood', 41.4792, -81.7799, 'east', 6500),
  res('r6', 'Lake Rd #3050', 'Rocky River', 41.4871, -81.8401, 'river', 6000),
  res('r7', 'Wooster Rd #880', 'Rocky River', 41.4689, -81.8431, 'river', 5500),
  // This one's card declines, so the failed-card path shows up in the demo.
  res('r8', 'Riverside Dr #19', 'Lakewood', 41.4720, -81.8175, 'west', 5000, 'pm_mock_0002'),
  // 10 commercial lots, per inch tier or per event, 1 to 2" trigger, salt per 50 lb bag at $18.
  { key: 'c1', label: 'Madison Ave Retail Lot', street: '13400 Madison Ave', city: 'Lakewood', lat: 41.4752, lon: -81.7855, kind: 'commercial', route: 'east', trigger: 1, pricing: tiers(15000, 22500, 30000), salt: true, billing: 'invoice_net30', priority: 1, open_by: '06:00' },
  { key: 'c2', label: 'Detroit Ave Storefront Row', street: '15200 Detroit Ave', city: 'Lakewood', lat: 41.4834, lon: -81.8015, kind: 'commercial', route: 'west', trigger: 1, pricing: { type: 'per_event', amount_cents: 28000 }, salt: true, billing: 'invoice_net30', priority: 1, open_by: '06:30' },
  { key: 'c3', label: 'Warren Rd Medical Office Lot', street: '2000 Warren Rd', city: 'Lakewood', lat: 41.4770, lon: -81.8150, kind: 'commercial', route: 'west', trigger: 1, pricing: tiers(20000, 30000, 40000), salt: true, billing: 'ach_on_file', pm: 'pm_mock_bank', priority: 1, open_by: '05:30' },
  { key: 'c4', label: 'Clifton Blvd Office Lot', street: '11800 Clifton Blvd', city: 'Lakewood', lat: 41.4887, lon: -81.7720, kind: 'commercial', route: 'east', trigger: 2, pricing: { type: 'per_event', amount_cents: 35000 }, salt: true, billing: 'invoice_net30', priority: 2 },
  { key: 'c5', label: 'Detroit Rd Plaza Lot', street: '20100 Detroit Rd', city: 'Rocky River', lat: 41.4782, lon: -81.8420, kind: 'commercial', route: 'river', trigger: 1, pricing: tiers(25000, 37500, 50000), salt: true, billing: 'invoice_net30', priority: 1, open_by: '06:00' },
  { key: 'c6', label: 'Hilliard Blvd Bank Lot', street: '19900 Hilliard Blvd', city: 'Rocky River', lat: 41.4655, lon: -81.8385, kind: 'commercial', route: 'river', trigger: 2, pricing: { type: 'per_event', amount_cents: 24000 }, salt: true, billing: 'card_on_file', pm: 'pm_mock_4242', priority: 2 },
  { key: 'c7', label: 'Lorain Ave Auto Service Lot', street: '11600 Lorain Ave', city: 'Cleveland', lat: 41.4560, lon: -81.7645, kind: 'commercial', route: 'east', trigger: 2, pricing: tiers(12000, 18000, 24000), salt: true, billing: 'card_on_file', pm: 'pm_mock_4242', priority: 3 },
  { key: 'c8', label: 'West 117th Retail Strip', street: '1800 W 117th St', city: 'Cleveland', lat: 41.4800, lon: -81.7600, kind: 'commercial', route: 'east', trigger: 1, pricing: { type: 'per_event', amount_cents: 26000 }, salt: true, billing: 'invoice_net30', priority: 2 },
  { key: 'c9', label: 'Center Ridge Church Lot', street: '21000 Center Ridge Rd', city: 'Rocky River', lat: 41.4592, lon: -81.8505, kind: 'commercial', route: 'river', trigger: 2, pricing: tiers(18000, 27000, 36000), salt: true, billing: 'manual', priority: 3 },
  { key: 'c10', label: 'Sloane Ave Dental Lot', street: '12700 Sloane Ave', city: 'Lakewood', lat: 41.4805, lon: -81.8120, kind: 'commercial', route: 'west', trigger: 2, pricing: { type: 'per_event', amount_cents: 18000 }, salt: true, billing: 'card_on_file', pm: 'pm_mock_4242', priority: 2 },
  // 4 HOAs, seasonal $2,400 to $6,000 in 5 installments.
  { key: 'h1', label: 'Clifton Blvd Condo HOA', street: '12500 Clifton Blvd', city: 'Lakewood', lat: 41.4893, lon: -81.7800, kind: 'hoa', route: 'east', trigger: 2, pricing: { type: 'seasonal', total_cents: 480000, installments: 5 }, salt: true, billing: 'invoice_net30', priority: 2 },
  { key: 'h2', label: 'Edgewater Dr Townhome HOA', street: '11000 Edgewater Dr', city: 'Cleveland', lat: 41.4885, lon: -81.7490, kind: 'hoa', route: 'east', trigger: 2, pricing: { type: 'seasonal', total_cents: 600000, installments: 5 }, salt: true, billing: 'invoice_net30', priority: 2 },
  { key: 'h3', label: 'Lake Rd Condo HOA', street: '19000 Lake Rd', city: 'Rocky River', lat: 41.4860, lon: -81.8330, kind: 'hoa', route: 'river', trigger: 2, pricing: { type: 'seasonal', total_cents: 360000, installments: 5 }, salt: false, billing: 'invoice_net30', priority: 3 },
  { key: 'h4', label: 'Riverside Dr Townhome HOA', street: '3300 Riverside Dr', city: 'Lakewood', lat: 41.4650, lon: -81.8190, kind: 'hoa', route: 'west', trigger: 2, pricing: { type: 'seasonal', total_cents: 240000, installments: 5 }, salt: false, billing: 'invoice_net30', priority: 3 },
  // 2 hourly loader sites.
  { key: 'l1', label: 'Berea Rd Yard (loader)', street: '13000 Berea Rd', city: 'Cleveland', lat: 41.4630, lon: -81.7790, kind: 'commercial', route: 'east', trigger: 2, pricing: { type: 'hourly', rate_cents: 14500 }, salt: false, billing: 'invoice_net30', priority: 3 },
  { key: 'l2', label: 'Hilliard Rd Warehouse (loader)', street: '16800 Hilliard Rd', city: 'Lakewood', lat: 41.4660, lon: -81.8090, kind: 'commercial', route: 'west', trigger: 2, pricing: { type: 'hourly', rate_cents: 12500 }, salt: false, billing: 'invoice_net30', priority: 3 },
];

export const SEED_CREW = [
  { key: 'dale', name: 'Dale Example', phone: '+12165550101', email: 'dale@flake.test', kind: 'employee' as const, language: 'en' as const, route: 'west' as const },
  { key: 'marisol', name: 'Marisol Sample', phone: '+12165550102', email: 'marisol@flake.test', kind: 'employee' as const, language: 'es' as const, route: 'east' as const },
  { key: 'teo', name: 'Teo Placeholder', phone: '+12165550103', email: 'teo@flake.test', kind: 'employee' as const, language: 'en' as const, route: 'river' as const },
  { key: 'sub', name: 'Sam Subcontractor (Demo)', phone: '+12165550104', email: 'sub@flake.test', kind: 'sub' as const, language: 'en' as const, route: null },
];

export const SEED_ROUTES = [
  { key: 'west', name: 'West Lakewood', crew: 'dale' },
  { key: 'east', name: 'East Lakewood + Cleveland West', crew: 'marisol' },
  { key: 'river', name: 'Rocky River', crew: 'teo' },
] as const;
