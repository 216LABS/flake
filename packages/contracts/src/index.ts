import { z } from 'zod';

/** Real coordinates only: a stray 999 from a phone or a typo would break distances and routes. */
const latN = z.number().min(-90).max(90);
const lonN = z.number().min(-180).max(180);

const cents = z.number().int().min(0).max(100_000_00);
/** Every date on the company's pages is shown in this zone, so a made-up one would break them all. */
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const timeZone = z.string().max(64).refine(isTimeZone, 'Choose a time zone from the list');
const uuid = z.uuid();
/** People type 216-555-0123. US numbers normalize to E.164; anything else must already be in it. */
const e164 = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim().startsWith('+')) return typeof v === 'string' ? v.trim() : v;
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return v;
}, z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a full phone number with area code'));
const email = z.email();
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());

export const pricingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('per_push'), amount_cents: cents }),
  z.object({
    type: z.literal('per_inch_tier'),
    tiers: z.array(z.object({ up_to_in: z.number().positive().max(120).nullable(), amount_cents: cents })).min(1).max(20),
  }),
  z.object({ type: z.literal('per_event'), amount_cents: cents }),
  z.object({ type: z.literal('seasonal'), total_cents: cents, installments: z.number().int().min(1).max(12) }),
  z.object({ type: z.literal('hourly'), rate_cents: cents }),
]);

export const serviceKind = z.enum(['plow', 'salt', 'walks', 'haul']);
export const saltUnit = z.enum(['bag50lb', 'lb', 'ton', 'application']);

export const contractServiceSchema = z.object({
  service: serviceKind,
  trigger_in: z.number().min(0).max(48).nullable().optional(),
  pricing: pricingSchema.nullable().optional(),
});

export const saltPricingSchema = z.object({ unit: saltUnit, amount_cents: cents });

const billingMode = z.enum(['card_on_file', 'ach_on_file', 'invoice_net30', 'manual']);
const customerBase = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['residential', 'commercial', 'hoa']),
  contact_name: emptyToNull(z.string().max(200)),
  phone_e164: emptyToNull(e164),
  email: emptyToNull(email),
  billing_mode: billingMode,
});
export const customerCreate = customerBase.extend({ billing_mode: billingMode.default('card_on_file') });
// Update schemas come from the base: zod 4 applies defaults even through .partial(), which would reset fields.
export const customerUpdate = customerBase.partial();

const geoJsonGeom = z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.array(z.any()) });

const siteBase = z.object({
  customer_id: uuid,
  label: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  parcel_id: emptyToNull(z.string().max(100)),
  parcel_county: emptyToNull(z.string().max(100)),
  area_estimate_sqft: z.number().min(0).max(50_000_000).nullable().optional(),
  area_confirmed_sqft: z.number().min(0).max(50_000_000).nullable().optional(),
  polygons: geoJsonGeom.nullable().optional(),
  walk_lf: z.number().min(0).max(1_000_000).nullable().optional(),
  priority: z.number().int().min(1).max(5),
  service_window: z.object({ open_by: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), days: z.array(z.string().max(10)).max(7).optional() }).nullable().optional(),
  notes: emptyToNull(z.string().max(4000)),
});
export const siteCreate = siteBase.extend({ priority: z.number().int().min(1).max(5).default(3) });
export const siteUpdate = siteBase.partial();

export const pinCreate = z.object({
  site_id: uuid,
  kind: z.enum(['stake', 'pile', 'ada', 'entrance', 'hazard', 'other']),
  lat: latN.nullable().optional(),
  lon: lonN.nullable().optional(),
  note: emptyToNull(z.string().max(1000)),
});

export const contractCreate = z.object({
  site_id: uuid,
  season: z.string().min(1).max(40),
  services: z.array(contractServiceSchema).min(1).max(10),
  salt_pricing: saltPricingSchema.nullable().optional(),
  terms_md: emptyToNull(z.string().max(20000)),
});
export const contractUpdate = contractCreate.partial().extend({ status: z.enum(['draft', 'void']).optional() });

/** The same lot twice on one route would send the truck there twice. */
const siteList = z.array(uuid).max(500).transform((ids) => [...new Set(ids)]);
const routeBase = z.object({
  name: z.string().trim().min(1).max(120),
  default_crew_id: uuid.nullable().optional(),
  site_ids: siteList,
});
export const routeCreate = routeBase.extend({ site_ids: siteList.default([]) });
export const routeUpdate = routeBase.partial();

export const subRateCard = z.object({
  per_visit_cents: cents.optional(),
  hourly_cents: cents.optional(),
  per_bag_cents: cents.optional(),
});

const crewBase = z.object({
  name: z.string().trim().min(1).max(120),
  phone_e164: emptyToNull(e164),
  email: emptyToNull(email),
  kind: z.enum(['employee', 'sub']),
  language: z.enum(['en', 'es']),
  sub_rate_card: subRateCard.nullable().optional(),
});
export const crewCreate = crewBase.extend({ language: z.enum(['en', 'es']).default('en') });
export const crewUpdate = crewBase.partial().extend({ active: z.boolean().optional() });

export const measureRequest = z.object({ lat: latN, lon: lonN, land_use: z.enum(['residential', 'commercial']).default('commercial') });
export const geocodeRequest = z.object({ q: z.string().trim().min(3).max(300) });

export const quoteCreate = contractCreate.extend({ send: z.boolean().default(true) });

export const stormCreate = z.object({
  name: z.string().trim().min(1).max(120),
  routeIds: z.array(uuid).max(200).transform((ids) => [...new Set(ids)]).default([]),
  crewAssignments: z.record(z.string(), uuid).default({}),
  triggerAlertId: uuid.optional(),
  /** Only snapshot these sites from the routes; used when starting from an alert. */
  siteIds: z.array(uuid).optional(),
});

export const runStopPatch = z.object({
  storm_run_id: uuid.optional(),
  seq: z.number().int().min(0).optional(),
  status: z.enum(['skipped', 'open']).optional(),
});

export const runPatch = z.object({ crew_id: uuid });
export const stormNotify = z.object({ siteIds: z.array(uuid).min(1), template: z.enum(['late', 'on_the_way']), time: z.string().max(40).optional() });
export const stormClose = z.object({ force: z.boolean().default(false) });
export const stormCallOut = z.object({ time: z.string().max(40) });

export const billingRetry = z.object({ draftId: uuid });
export const billingApprove = z.object({ draftIds: z.array(uuid).min(1).max(500) });
export const flagFix = z.discriminatedUnion('action', [
  z.object({ action: z.literal('waive'), storm_id: uuid, flag_key: z.string().max(200) }),
  z.object({ action: z.literal('skip'), storm_id: uuid, site_id: uuid }),
  z.object({ action: z.literal('replow'), storm_id: uuid, visit_id: uuid }),
  z.object({ action: z.literal('salt'), storm_id: uuid, visit_id: uuid, unit: saltUnit, qty: z.number().positive().max(10000) }),
  z.object({ action: z.literal('depth'), storm_id: uuid, site_id: uuid, depth_in: z.number().min(0).max(120) }),
]);

export const proofRequest = z.object({ siteId: uuid, from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });

const baseAction = {
  client_uuid: uuid,
  at: z.iso.datetime({ offset: true }),
  run_stop_id: uuid.optional(),
};
const gps = z.object({ lat: latN, lon: lonN, acc: z.number().min(0).max(100_000).nullable().optional() }).nullable().optional();
const saltEntries = z.array(z.object({ unit: z.string().max(20), qty: z.number().min(0).max(10000) }));

export const driverAction = z.discriminatedUnion('kind', [
  z.object({ ...baseAction, kind: z.literal('enroute'), run_stop_id: uuid }),
  z.object({ ...baseAction, kind: z.literal('arrive'), run_stop_id: uuid, visit_client_uuid: uuid, gps }),
  z.object({ ...baseAction, kind: z.literal('depth'), run_stop_id: uuid, visit_client_uuid: uuid, depth_in: z.number().min(0).max(120), gps }),
  z.object({ ...baseAction, kind: z.literal('salt'), run_stop_id: uuid, visit_client_uuid: uuid, salt: saltEntries }),
  z.object({ ...baseAction, kind: z.literal('photo_meta'), run_stop_id: uuid, visit_client_uuid: uuid, photo_client_uuid: uuid, phase: z.enum(['before', 'after', 'issue']) }),
  z.object({
    ...baseAction,
    kind: z.literal('done'),
    run_stop_id: uuid,
    visit_client_uuid: uuid,
    services: z.array(z.string().max(20)).max(10),
    depth_in: z.number().min(0).max(120).nullable().optional(),
    salt: saltEntries.nullable().optional(),
    gps,
    /** Photos the phone took for this visit, which upload after this action. */
    photos_coming: z.number().int().min(0).max(10).optional(),
  }),
  z.object({
    ...baseAction,
    kind: z.literal('problem'),
    run_stop_id: uuid,
    problem: z.enum(['blocked', 'breakdown', 'skip', 'damage', 'other']),
    note: z.string().max(2000).nullable().optional(),
    voice_client_uuid: uuid.nullable().optional(),
  }),
  z.object({ ...baseAction, kind: z.literal('undo_last'), visit_client_uuid: uuid, run_stop_id: uuid }),
]);
export type DriverAction = z.infer<typeof driverAction>;

export const driverActions = z.object({ actions: z.array(driverAction).min(1).max(200) });
/** The batch shape only. Each action validates on its own, so one bad one can't block a phone's whole outbox. */
export const driverActionBatch = z.object({ actions: z.array(z.unknown()).min(1).max(200) });
export const driverPosition = z.object({ lat: latN, lon: lonN, acc: z.number().min(0).max(100_000).nullable().optional(), at: z.iso.datetime({ offset: true }) });
export const driverPhotoMeta = z.object({
  client_uuid: uuid,
  visit_client_uuid: uuid.optional(),
  phase: z.enum(['before', 'after', 'issue', 'voice']),
  taken_at: z.iso.datetime({ offset: true }).optional(),
  problem_client_uuid: uuid.optional(),
});

/** Direct-to-storage upload for full-size photos, which exceed the host's request body limit. */
export const driverPhotoUpload = z.object({
  client_uuid: uuid,
  visit_client_uuid: uuid,
  phase: z.enum(['before', 'after', 'issue']),
  taken_at: z.iso.datetime({ offset: true }).optional(),
  content_type: z.string().regex(/^image\/[a-z0-9.+-]+$/),
});

export const quoteAccept = z.object({
  name: z.string().trim().min(2).max(200),
  agree: z.literal(true),
  consentSms: z.boolean().default(false),
  consentEmail: z.boolean().default(true),
  phone_e164: emptyToNull(e164),
});
export const mockConfirm = z.object({ card: z.string().regex(/^\d{4,19}$/).optional(), bank: z.boolean().optional() });

export const toolContract = z.object({
  company: z.string().trim().min(1).max(200),
  client: z.string().trim().min(1).max(200),
  site: z.string().trim().min(1).max(300),
  season_start: z.string().min(1).max(40),
  season_end: z.string().min(1).max(40),
  services: z.array(serviceKind).min(1),
  trigger_in: z.number().min(0).max(48),
  pricing_type: z.enum(['per_push', 'per_inch_tier', 'per_event', 'seasonal', 'hourly']),
  price_text: z.string().trim().min(1).max(500),
  salt_text: z.string().max(500).default(''),
  insurance_text: z.string().max(2000).default(''),
  payment_terms: z.string().max(500).default('Net 30'),
  email: emptyToNull(email),
});

export const toolPrice = z.object({
  sqft: z.number().positive().max(10_000_000).optional(),
  address: z.string().max(300).optional(),
  walks_lf: z.number().min(0).max(100000).default(0),
  trigger_in: z.number().min(0).max(48).default(2),
  per_sqft_cents_per_push: z.number().min(0).max(100).optional(),
  min_push_cents: cents.optional(),
  walks_per_lf_cents: z.number().min(0).max(1000).optional(),
  season_pushes: z.number().int().min(1).max(100).optional(),
  email: emptyToNull(email),
});

export const onboardTenant = z.object({ name: z.string().trim().min(2).max(120), timezone: timeZone.catch('America/New_York').default('America/New_York') });

export const tenantSettings = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: timeZone.optional(),
  business_legal_name: emptyToNull(z.string().max(200)),
  ein: z.string().regex(/^\d{2}-?\d{7}$/).optional(),
  address: z.object({ line1: z.string().max(200), city: z.string().max(100), state: z.string().max(40), zip: z.string().max(20) }).nullable().optional(),
  contact_email: emptyToNull(email),
  contact_phone: emptyToNull(e164),
  website: emptyToNull(z.url()),
  contact_name: emptyToNull(z.string().max(120)),
  expected_monthly_volume: z.number().int().min(1).max(1000000).optional(),
});
export const tollFreeSubmit = z.object({ ein: z.string().regex(/^\d{2}-?\d{7}$/, 'Use the format 12-3456789') });
export const rateCardSchema = z.object({
  per_sqft_cents_per_push: z.number().min(0).max(100),
  min_push_cents: cents,
  walks_per_lf_cents: z.number().min(0).max(1000),
  salt_bag_cents: cents,
  season_pushes: z.number().int().min(1).max(100),
  tiers: z.array(z.object({ up_to_in: z.number().positive().max(120).nullable(), multiplier: z.number().min(0.1).max(10) })).min(1).max(20),
});

/** The server POSTs to this URL, so only the real browser push services are allowed. Anything else would be SSRF. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
const pushEndpoint = z.url().max(1000).refine((u) => {
  const url = new URL(u);
  return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
}, 'Not a recognized push service');
export const pushSubscribe = z.object({ endpoint: pushEndpoint, keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }) });
export const pushUnsubscribe = z.object({ endpoint: z.string().max(1000) });
export const addressSuggest = z.object({ q: z.string().trim().min(3).max(200) });
export const teamAdd = z.object({ email, role: z.enum(['owner', 'dispatcher', 'viewer']) });
export const crewJoin = z.object({ consent: z.boolean(), email: z.union([z.email().max(254), z.literal('')]).optional() });
export const proCheckout = z.object({ interval: z.enum(['monthly', 'yearly']) });
