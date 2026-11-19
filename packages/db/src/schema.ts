import { sql } from 'drizzle-orm';
import { bigserial, boolean, date, doublePrecision, inet, integer, jsonb, numeric, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull();
const createdAt = () => ts('created_at').defaultNow();
const uuidArray = (name: string) => uuid(name).array();

export const tenant = pgTable('tenant', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/New_York'),
  plan: text('plan').$type<'free' | 'pro'>().notNull().default('free'),
  free_season_until: date('free_season_until', { mode: 'string' }),
  stripe_account_id: text('stripe_account_id'),
  stripe_charges_enabled: boolean('stripe_charges_enabled').default(false),
  stripe_platform_customer_id: text('stripe_platform_customer_id'),
  twilio_subaccount_sid: text('twilio_subaccount_sid'),
  sms_sender: text('sms_sender'),
  sms_status: text('sms_status').$type<'none' | 'pending' | 'approved' | 'rejected'>().default('none'),
  sms_status_detail: text('sms_status_detail'),
  sms_verification: jsonb('sms_verification').$type<Record<string, unknown> | null>(),
  business_legal_name: text('business_legal_name'),
  ein_last4: text('ein_last4'),
  address: jsonb('address').$type<Record<string, string> | null>(),
  /** Where trucks start and end (issue 64), geocoded by the server. */
  yard: jsonb('yard').$type<{ address: string; lat: number; lon: number } | null>(),
  contact_email: text('contact_email'),
  contact_phone: text('contact_phone'),
  /** How customers pay a bill the company collects itself, shown on their records page. */
  pay_instructions: text('pay_instructions'),
  rate_card: jsonb('rate_card').notNull().default(sql`'{}'::jsonb`),
  created_at: createdAt(),
  /** When renewal reminders start each year, MM-DD (issue 166). */
  renewal_start: text('renewal_start').notNull().default('08-01'),
  /** Pay period, workweek start (0 = Sunday) and holidays for the payroll export (issue 170). */
  payroll: jsonb('payroll').$type<{ period?: 'weekly' | 'biweekly'; week_start?: number; anchor?: string; holidays?: string[]; adp_co_code?: string }>().notNull().default(sql`'{}'::jsonb`),
  /** Flake sends email and texts for this company only once a platform admin turns this on (issue 171). */
  outbound_enabled: boolean('outbound_enabled').notNull().default(false),
  outbound_changed_at: ts('outbound_changed_at'),
  outbound_changed_by: text('outbound_changed_by'),
  /** Who agreed to the Terms and Privacy Policy at signup, when, and which versions (issue 172). */
  terms_accepted_at: ts('terms_accepted_at'),
  terms_accepted_by: uuid('terms_accepted_by'),
  terms_version: text('terms_version'),
  /** Storage path of the company's logo (issue 173). */
  logo_path: text('logo_path'),
});

export const membership = pgTable('membership', {
  tenant_id: uuid('tenant_id').notNull(),
  user_id: uuid('user_id').notNull(),
  role: text('role').$type<'owner' | 'dispatcher' | 'viewer'>().notNull(),
}, (t) => [primaryKey({ columns: [t.tenant_id, t.user_id] })]);

export const crew_member = pgTable('crew_member', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  phone_e164: text('phone_e164'),
  email: text('email'),
  kind: text('kind').$type<'employee' | 'sub'>().notNull(),
  language: text('language').$type<'en' | 'es'>().notNull().default('en'),
  sub_rate_card: jsonb('sub_rate_card'),
  active: boolean('active').default(true),
  invite_token_hash: text('invite_token_hash'),
  joined_at: ts('joined_at'),
  callout_reply: text('callout_reply'),
  callout_reply_at: ts('callout_reply_at'),
  /** Employee pay for the payroll export (issue 170). Ignored for subs. */
  pay_regular_cents: integer('pay_regular_cents'),
  pay_ot_cents: integer('pay_ot_cents'),
  pay_storm_cents: integer('pay_storm_cents'),
  pay_holiday_cents: integer('pay_holiday_cents'),
  payroll_id: text('payroll_id'),
  created_at: createdAt(),
});

export const customer = pgTable('customer', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  kind: text('kind').$type<'residential' | 'commercial' | 'hoa'>().notNull(),
  contact_name: text('contact_name'),
  phone_e164: text('phone_e164'),
  email: text('email'),
  billing_mode: text('billing_mode').$type<'card_on_file' | 'ach_on_file' | 'invoice_net30' | 'manual'>().notNull().default('card_on_file'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_payment_method_id: text('stripe_payment_method_id'),
  /** The matching QuickBooks Online customer, once the owner confirms it (issue 162). */
  qbo_customer_id: text('qbo_customer_id'),
  notify_sms: boolean('notify_sms').default(false),
  notify_email: boolean('notify_email').default(true),
  archived_at: ts('archived_at'),
  created_at: createdAt(),
});

export const site = pgTable('site', {
  id: id(),
  tenant_id: tenantId(),
  customer_id: uuid('customer_id').notNull(),
  label: text('label').notNull(),
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  nws_office: text('nws_office'),
  nws_grid_x: integer('nws_grid_x'),
  nws_grid_y: integer('nws_grid_y'),
  nws_station: text('nws_station'),
  nws_mapped_at: ts('nws_mapped_at'),
  parcel_id: text('parcel_id'),
  parcel_county: text('parcel_county'),
  area_estimate_sqft: numeric('area_estimate_sqft', { mode: 'number' }),
  area_confirmed_sqft: numeric('area_confirmed_sqft', { mode: 'number' }),
  polygons: jsonb('polygons'),
  walk_lf: numeric('walk_lf', { mode: 'number' }),
  priority: integer('priority').notNull().default(3),
  service_window: jsonb('service_window').$type<{ open_by?: string; not_before?: string; days?: string[] } | null>(),
  notes: text('notes'),
  active: boolean('active').default(true),
  created_at: createdAt(),
});

export const site_pin = pgTable('site_pin', {
  id: id(),
  tenant_id: tenantId(),
  site_id: uuid('site_id').notNull(),
  kind: text('kind'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  note: text('note'),
  photo_path: text('photo_path'),
  created_at: createdAt(),
});

export const contract = pgTable('contract', {
  id: id(),
  tenant_id: tenantId(),
  site_id: uuid('site_id').notNull(),
  season: text('season').notNull(),
  status: text('status').$type<'draft' | 'sent' | 'accepted' | 'void' | 'declined'>().notNull().default('draft'),
  services: jsonb('services').notNull(),
  salt_pricing: jsonb('salt_pricing'),
  terms_md: text('terms_md'),
  accepted_at: ts('accepted_at'),
  accepted_name: text('accepted_name'),
  accepted_ip: inet('accepted_ip'),
  pdf_path: text('pdf_path'),
  quote_token_hash: text('quote_token_hash'),
  quote_token_enc: text('quote_token_enc'),
  installments_billed: integer('installments_billed').notNull().default(0),
  declined_at: ts('declined_at'),
  decline_reason: text('decline_reason'),
  created_at: createdAt(),
});

export const route = pgTable('route', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  default_crew_id: uuid('default_crew_id'),
  archived_at: ts('archived_at'),
  /** Suggest order starts and ends this route at the yard, when the company has one (issue 64). */
  yard_trip: boolean('yard_trip').notNull().default(true),
  /** The truck that usually runs this route; each storm's run starts with it. */
  default_truck_id: uuid('default_truck_id'),
  created_at: createdAt(),
});

export const route_stop = pgTable('route_stop', {
  route_id: uuid('route_id').notNull(),
  site_id: uuid('site_id').notNull(),
  seq: integer('seq').notNull(),
  tenant_id: tenantId(),
}, (t) => [primaryKey({ columns: [t.route_id, t.site_id] })]);

export const weather_snapshot = pgTable('weather_snapshot', {
  id: id(),
  source: text('source').notNull(),
  office: text('office'),
  grid_x: integer('grid_x'),
  grid_y: integer('grid_y'),
  station: text('station'),
  fetched_at: ts('fetched_at').notNull(),
  last_modified: ts('last_modified'),
  request_url: text('request_url').notNull(),
  storage_path: text('storage_path').notNull(),
  sha256: text('sha256').notNull(),
  summary: jsonb('summary').$type<Record<string, any>>().notNull(),
});

export const trigger_alert = pgTable('trigger_alert', {
  id: id(),
  tenant_id: tenantId(),
  kind: text('kind').$type<'forecast' | 'depth_report' | 'refreeze' | 'nws_alert'>(),
  site_ids: uuidArray('site_ids').notNull(),
  detail: jsonb('detail').$type<Record<string, any>>().notNull(),
  snapshot_ids: uuidArray('snapshot_ids').notNull().default(sql`'{}'`),
  status: text('status').$type<'open' | 'dispatched' | 'dismissed'>().default('open'),
  created_at: createdAt(),
});

export const storm = pgTable('storm', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  started_at: ts('started_at').notNull(),
  closed_at: ts('closed_at'),
  trigger_alert_id: uuid('trigger_alert_id'),
  status: text('status').$type<'active' | 'closed' | 'billed'>().notNull().default('active'),
  forecast_snapshot_ids: uuidArray('forecast_snapshot_ids').default(sql`'{}'`),
  waived_flags: text('waived_flags').array().notNull().default(sql`'{}'`),
});

export const storm_run = pgTable('storm_run', {
  id: id(),
  tenant_id: tenantId(),
  storm_id: uuid('storm_id').notNull(),
  route_id: uuid('route_id'),
  crew_id: uuid('crew_id'),
  pass: integer('pass').notNull().default(1),
  link_token_hash: text('link_token_hash').notNull(),
  link_token_enc: text('link_token_enc'),
  link_expires_at: ts('link_expires_at').notNull(),
  link_revoked_at: ts('link_revoked_at'),
  /** The first time the driver app loaded this run (issue 86). */
  link_opened_at: ts('link_opened_at'),
  published_at: ts('published_at'),
  started_at: ts('started_at'),
  /** The truck that ran this route in this storm, for damage questions and fuel per storm. */
  truck_id: uuid('truck_id'),
  /** The yard this run loads salt from (issue 169). */
  yard_id: uuid('yard_id'),
  created_at: createdAt(),
});

export type StopStatus = 'open' | 'enroute' | 'onsite' | 'done' | 'skipped' | 'problem';

export const run_stop = pgTable('run_stop', {
  id: id(),
  tenant_id: tenantId(),
  storm_run_id: uuid('storm_run_id').notNull(),
  site_id: uuid('site_id').notNull(),
  seq: integer('seq').notNull(),
  status: text('status').$type<StopStatus>().notNull().default('open'),
  previous_run_ids: uuidArray('previous_run_ids').notNull().default(sql`'{}'`),
  updated_at: ts('updated_at').defaultNow(),
});

export const visit = pgTable('visit', {
  id: id(),
  tenant_id: tenantId(),
  client_uuid: uuid('client_uuid').notNull().unique(),
  storm_id: uuid('storm_id').notNull(),
  run_stop_id: uuid('run_stop_id'),
  site_id: uuid('site_id').notNull(),
  crew_id: uuid('crew_id').notNull(),
  services: text('services').array().notNull(),
  arrived_device_at: ts('arrived_device_at').notNull(),
  departed_device_at: ts('departed_device_at'),
  arrived_received_at: ts('arrived_received_at').notNull().defaultNow(),
  departed_received_at: ts('departed_received_at'),
  arrive_lat: doublePrecision('arrive_lat'),
  arrive_lon: doublePrecision('arrive_lon'),
  arrive_acc_m: real('arrive_acc_m'),
  depart_lat: doublePrecision('depart_lat'),
  depart_lon: doublePrecision('depart_lon'),
  depth_in: numeric('depth_in', { mode: 'number' }),
  salt: jsonb('salt').$type<{ unit: string; qty: number }[] | null>(),
  notes: text('notes'),
  voice_path: text('voice_path'),
  gps_match: boolean('gps_match'),
  is_replow: boolean('is_replow').default(false),
});

export const visit_photo = pgTable('visit_photo', {
  id: id(),
  tenant_id: tenantId(),
  visit_id: uuid('visit_id').notNull(),
  client_uuid: uuid('client_uuid').notNull().unique(),
  phase: text('phase').$type<'before' | 'after' | 'issue'>(),
  storage_path: text('storage_path').notNull(),
  sha256: text('sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  taken_device_at: ts('taken_device_at'),
  received_at: ts('received_at').defaultNow(),
  exif: jsonb('exif'),
});

export const visit_correction = pgTable('visit_correction', {
  id: id(),
  tenant_id: tenantId(),
  visit_id: uuid('visit_id').notNull(),
  field: text('field').notNull(),
  old_value: jsonb('old_value'),
  new_value: jsonb('new_value'),
  reason: text('reason').notNull(),
  by_user: uuid('by_user'),
  by_crew: uuid('by_crew'),
  client_uuid: uuid('client_uuid').unique(),
  created_at: createdAt(),
});

export const problem_report = pgTable('problem_report', {
  id: id(),
  tenant_id: tenantId(),
  client_uuid: uuid('client_uuid').unique(),
  storm_run_id: uuid('storm_run_id'),
  site_id: uuid('site_id'),
  crew_id: uuid('crew_id'),
  kind: text('kind'),
  note: text('note'),
  voice_path: text('voice_path'),
  resolved_at: ts('resolved_at'),
  created_at: createdAt(),
});

export type DraftStatus = 'draft' | 'approved' | 'charged' | 'sent' | 'paid' | 'failed' | 'void';

export const invoice_draft = pgTable('invoice_draft', {
  id: id(),
  tenant_id: tenantId(),
  storm_id: uuid('storm_id').notNull(),
  customer_id: uuid('customer_id').notNull(),
  lines: jsonb('lines').$type<any[]>().notNull(),
  subtotal_cents: integer('subtotal_cents').notNull(),
  flags: jsonb('flags').$type<any[]>().notNull().default(sql`'[]'::jsonb`),
  status: text('status').$type<DraftStatus>().default('draft'),
  status_detail: text('status_detail'),
  stripe_payment_intent_id: text('stripe_payment_intent_id'),
  stripe_invoice_id: text('stripe_invoice_id'),
  pay_link: text('pay_link'),
  disputed: boolean('disputed').notNull().default(false),
  application_fee_cents: integer('application_fee_cents'),
  /** A due date the office set on this bill (issue 168). */
  due_on: date('due_on', { mode: 'string' }),
  /** QuickBooks sync state, written only by the server's sync job (issue 162). */
  qbo_invoice_id: text('qbo_invoice_id'),
  qbo_sync_token: text('qbo_sync_token'),
  qbo_synced_at: ts('qbo_synced_at'),
  qbo_error: text('qbo_error'),
  created_at: createdAt(),
});

export const installment_invoice = pgTable('installment_invoice', {
  id: id(),
  tenant_id: tenantId(),
  contract_id: uuid('contract_id').notNull(),
  seq: integer('seq').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  stripe_invoice_id: text('stripe_invoice_id'),
  status: text('status').notNull().default('sent'),
  /** The month billed, like 2026-11. One installment per contract per month. */
  period: text('period'),
  due_on: date('due_on', { mode: 'string' }),
  qbo_invoice_id: text('qbo_invoice_id'),
  qbo_sync_token: text('qbo_sync_token'),
  qbo_synced_at: ts('qbo_synced_at'),
  qbo_error: text('qbo_error'),
  created_at: createdAt(),
});

export const message_log = pgTable('message_log', {
  id: id(),
  tenant_id: tenantId(),
  channel: text('channel').$type<'sms' | 'email' | 'push'>(),
  to_addr: text('to_addr').notNull(),
  template: text('template').notNull(),
  body: text('body').notNull(),
  related: jsonb('related').$type<Record<string, any> | null>(),
  provider_id: text('provider_id'),
  status: text('status'),
  idempotency_key: text('idempotency_key').notNull(),
  created_at: createdAt(),
});

export const sms_consent = pgTable('sms_consent', {
  tenant_id: tenantId(),
  phone_e164: text('phone_e164').notNull(),
  party: text('party').$type<'crew' | 'customer'>(),
  opted_in_at: ts('opted_in_at'),
  opted_in_source: text('opted_in_source'),
  opted_out_at: ts('opted_out_at'),
}, (t) => [primaryKey({ columns: [t.tenant_id, t.phone_e164] })]);

export const proof_packet = pgTable('proof_packet', {
  id: id(),
  tenant_id: tenantId(),
  site_id: uuid('site_id').notNull(),
  from_ts: ts('from_ts').notNull(),
  to_ts: ts('to_ts').notNull(),
  pdf_path: text('pdf_path').notNull(),
  sha256: text('sha256').notNull(),
  manifest: jsonb('manifest').notNull(),
  manifest_sha256: text('manifest_sha256'),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});

export const job = pgTable('job', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, any>>().notNull(),
  run_at: ts('run_at').defaultNow(),
  attempts: integer('attempts').default(0),
  max_attempts: integer('max_attempts').default(8),
  locked_until: ts('locked_until'),
  last_error: text('last_error'),
  done_at: ts('done_at'),
  dead_at: ts('dead_at'),
  dedupe_key: text('dedupe_key').unique(),
});

export const stripe_event = pgTable('stripe_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  received_at: ts('received_at').defaultNow(),
  processed_at: ts('processed_at'),
});

export const lead = pgTable('lead', {
  id: id(),
  source: text('source'),
  email: text('email').notNull(),
  business: text('business'),
  payload: jsonb('payload'),
  created_at: createdAt(),
});

export const driver_action = pgTable('driver_action', {
  id: id(),
  tenant_id: tenantId(),
  client_uuid: uuid('client_uuid').notNull().unique(),
  storm_run_id: uuid('storm_run_id').notNull(),
  run_stop_id: uuid('run_stop_id'),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, any>>().notNull(),
  device_at: ts('device_at').notNull(),
  received_at: ts('received_at').notNull().defaultNow(),
});

export const driver_position = pgTable('driver_position', {
  id: id(),
  tenant_id: tenantId(),
  storm_run_id: uuid('storm_run_id').notNull(),
  crew_id: uuid('crew_id'),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  acc_m: real('acc_m'),
  device_at: ts('device_at').notNull(),
  received_at: ts('received_at').notNull().defaultNow(),
});

export const short_link = pgTable('short_link', {
  code: text('code').primaryKey(),
  tenant_id: tenantId(),
  target: text('target').notNull(),
  created_at: createdAt(),
});

export const push_subscription = pgTable('push_subscription', {
  id: id(),
  tenant_id: tenantId(),
  user_id: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  created_at: createdAt(),
});

export const cached_lookup = pgTable('cached_lookup', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  fetched_at: ts('fetched_at').notNull().defaultNow(),
});

/** Rate-limit counts shared by every server instance (issue 176). Server only. */
export const rate_limit = pgTable('rate_limit', {
  key: text('key').notNull(),
  window_start: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull(),
  n: integer('n').notNull().default(1),
}, (t) => [primaryKey({ columns: [t.key, t.window_start] })]);

export const app_setting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<any>().notNull(),
});

/** Partner salt distributors. Global, not per tenant: every contractor near one can order from it. */
export const salt_supplier = pgTable('salt_supplier', {
  id: id(),
  name: text('name').notNull(),
  contact_name: text('contact_name'),
  email: text('email').notNull(),
  phone: text('phone'),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  radius_mi: numeric('radius_mi', { mode: 'number' }).notNull().default(40),
  price_per_ton_cents: integer('price_per_ton_cents').notNull(),
  truckload_tons: numeric('truckload_tons', { mode: 'number' }).notNull().default(22),
  stop_fee_cents: integer('stop_fee_cents').notNull().default(0),
  referral_fee_per_ton_cents: integer('referral_fee_per_ton_cents').notNull().default(0),
  active: boolean('active').notNull().default(true),
  link_rev: integer('link_rev').notNull().default(1),
  created_at: createdAt(),
});

export const salt_pool = pgTable('salt_pool', {
  id: id(),
  supplier_id: uuid('supplier_id').notNull(),
  status: text('status').$type<'open' | 'sent' | 'cancelled'>().notNull().default('open'),
  truckload_tons: numeric('truckload_tons', { mode: 'number' }).notNull(),
  created_at: createdAt(),
  sent_at: ts('sent_at'),
});

export type SaltOrderStatus = 'pooling' | 'ordered' | 'scheduled' | 'delivered' | 'cancelled';
export const salt_order = pgTable('salt_order', {
  id: id(),
  tenant_id: tenantId(),
  supplier_id: uuid('supplier_id').notNull(),
  pool_id: uuid('pool_id'),
  tons: numeric('tons', { mode: 'number' }).notNull(),
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  needed_by: date('needed_by', { mode: 'string' }),
  contact_name: text('contact_name'),
  contact_phone: text('contact_phone'),
  notes: text('notes'),
  status: text('status').$type<SaltOrderStatus>().notNull().default('pooling'),
  price_per_ton_cents: integer('price_per_ton_cents').notNull(),
  stop_fee_cents: integer('stop_fee_cents').notNull().default(0),
  referral_fee_per_ton_cents: integer('referral_fee_per_ton_cents').notNull().default(0),
  delivery_date: date('delivery_date', { mode: 'string' }),
  delivered_tons: numeric('delivered_tons', { mode: 'number' }),
  created_by: uuid('created_by'),
  created_at: createdAt(),
  updated_at: ts('updated_at').defaultNow(),
  yard_id: uuid('yard_id'),
});

/** What a lot looked like before the first snow: damage already there, where piles go, hazards. */
export const site_walk_item = pgTable('site_walk_item', {
  id: id(),
  tenant_id: tenantId(),
  site_id: uuid('site_id').notNull(),
  season: text('season').notNull(),
  kind: text('kind').$type<'damage' | 'pile' | 'hazard' | 'drain' | 'note'>().notNull(),
  note: text('note'),
  photo_path: text('photo_path'),
  photo_sha256: text('photo_sha256'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  taken_at: ts('taken_at'),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});

export const truck = pgTable('truck', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  kind: text('kind').$type<'truck' | 'loader' | 'skid_steer' | 'spreader' | 'other'>().notNull().default('truck'),
  plate: text('plate'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  created_at: createdAt(),
});

/** Fuel, engine or blade hours, and maintenance, per truck and, when it happened in one, per storm. */
export const equipment_log = pgTable('equipment_log', {
  id: id(),
  tenant_id: tenantId(),
  truck_id: uuid('truck_id').notNull(),
  storm_id: uuid('storm_id'),
  kind: text('kind').$type<'fuel' | 'hours' | 'maintenance' | 'note'>().notNull(),
  gallons: numeric('gallons', { mode: 'number' }),
  cost_cents: integer('cost_cents'),
  hours: numeric('hours', { mode: 'number' }),
  note: text('note'),
  at: ts('at').notNull().defaultNow(),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});

/** "Oil change every 250 hours", "Blade check every 30 days" on one truck (issue 161). */
export const maintenance_item = pgTable('maintenance_item', {
  id: id(),
  tenant_id: tenantId(),
  truck_id: uuid('truck_id').notNull(),
  name: text('name').notNull(),
  every_hours: numeric('every_hours', { mode: 'number' }),
  every_days: integer('every_days'),
  last_done_at: ts('last_done_at'),
  last_done_hours: numeric('last_done_hours', { mode: 'number' }),
  created_at: createdAt(),
});

/** One accounting connection per company (issue 162). Server only: tokens are encrypted and never sent to a browser. */
export const integration = pgTable('integration', {
  id: id(),
  tenant_id: tenantId(),
  provider: text('provider').$type<'qbo'>().notNull(),
  realm_id: text('realm_id'),
  token_enc: text('token_enc'),
  refresh_enc: text('refresh_enc'),
  expires_at: ts('expires_at'),
  status: text('status').$type<'connected' | 'disconnected' | 'error'>().notNull().default('connected'),
  status_detail: text('status_detail'),
  connected_by: uuid('connected_by'),
  created_at: createdAt(),
  updated_at: ts('updated_at').notNull().defaultNow(),
});

/** Which QuickBooks item each kind of Flake line posts to. */
export const qbo_item_map = pgTable('qbo_item_map', {
  tenant_id: tenantId(),
  flake_key: text('flake_key').$type<'plow' | 'salt' | 'walks' | 'haul' | 'seasonal' | 'other'>().notNull(),
  qbo_item_id: text('qbo_item_id').notNull(),
  qbo_item_name: text('qbo_item_name'),
}, (t) => [primaryKey({ columns: [t.tenant_id, t.flake_key] })]);

/** A certificate of insurance or W-9: the company's own when crew_id is null, else a sub's (issue 165). */
export const certificate = pgTable('certificate', {
  id: id(),
  tenant_id: tenantId(),
  crew_id: uuid('crew_id'),
  kind: text('kind').$type<'general_liability' | 'auto' | 'workers_comp' | 'umbrella' | 'w9' | 'other'>().notNull(),
  insurer: text('insurer'),
  policy_number: text('policy_number'),
  effective_on: date('effective_on', { mode: 'string' }),
  expires_on: date('expires_on', { mode: 'string' }),
  file_path: text('file_path'),
  file_sha256: text('file_sha256'),
  file_name: text('file_name'),
  is_default: boolean('is_default').notNull().default(false),
  notes: text('notes'),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});

/** A claim on a lot and where it stands, with its incident packets (issue 165). */
export const claim = pgTable('claim', {
  id: id(),
  tenant_id: tenantId(),
  site_id: uuid('site_id').notNull(),
  incident_at: ts('incident_at').notNull(),
  reference: text('reference'),
  adjuster: text('adjuster'),
  status: text('status').$type<'open' | 'pending' | 'closed' | 'denied'>().notNull().default('open'),
  notes: text('notes'),
  proof_packet_ids: uuidArray('proof_packet_ids').notNull().default(sql`'{}'`),
  created_by: uuid('created_by'),
  created_at: createdAt(),
  updated_at: ts('updated_at').notNull().defaultNow(),
});

export type BidStage = 'lead' | 'site_walk' | 'quote_sent' | 'won' | 'lost';
/** A bid from lead to won or lost (issue 166). */
export const bid = pgTable('bid', {
  id: id(),
  tenant_id: tenantId(),
  customer_id: uuid('customer_id'),
  prospect_name: text('prospect_name'),
  prospect_contact: text('prospect_contact'),
  site_ids: uuidArray('site_ids').notNull().default(sql`'{}'`),
  stage: text('stage').$type<BidStage>().notNull().default('lead'),
  season: text('season').notNull(),
  estimated_cents: integer('estimated_cents'),
  notes: text('notes'),
  lost_reason: text('lost_reason'),
  contract_id: uuid('contract_id'),
  created_by: uuid('created_by'),
  created_at: createdAt(),
  updated_at: ts('updated_at').notNull().defaultNow(),
});

/** Money received outside a card: a check, ACH or cash, against one bill or installment (issue 168). */
export const payment = pgTable('payment', {
  id: id(),
  tenant_id: tenantId(),
  customer_id: uuid('customer_id').notNull(),
  draft_id: uuid('draft_id'),
  installment_id: uuid('installment_id'),
  amount_cents: integer('amount_cents').notNull(),
  method: text('method').$type<'check' | 'ach' | 'cash' | 'card' | 'other'>().notNull(),
  reference: text('reference'),
  paid_on: date('paid_on', { mode: 'string' }).notNull(),
  voided_at: ts('voided_at'),
  void_reason: text('void_reason'),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});

/** Where salt is piled (issue 169). */
export const yard = pgTable('yard', {
  id: id(),
  tenant_id: tenantId(),
  name: text('name').notNull(),
  address: text('address'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  reorder_tons: numeric('reorder_tons', { mode: 'number' }),
  active: boolean('active').notNull().default(true),
  created_at: createdAt(),
});

/** Salt into a yard (deliveries, with cost) and counted adjustments. Salt spread is read from visits (issue 169). */
export const salt_ledger = pgTable('salt_ledger', {
  id: id(),
  tenant_id: tenantId(),
  yard_id: uuid('yard_id').notNull(),
  qty_tons: numeric('qty_tons', { mode: 'number' }).notNull(),
  cost_cents: integer('cost_cents'),
  source: text('source').$type<'order' | 'delivery' | 'adjustment' | 'count'>().notNull(),
  salt_order_id: uuid('salt_order_id'),
  supplier: text('supplier'),
  note: text('note'),
  at: ts('at').notNull().defaultNow(),
  created_by: uuid('created_by'),
  created_at: createdAt(),
});
