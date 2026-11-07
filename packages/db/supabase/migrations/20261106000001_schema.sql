-- Flake v1 schema (BUILD_SPEC section 2), plus the additions noted inline.

create table tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'America/New_York',
  plan text not null default 'free' check (plan in ('free','pro')),
  free_season_until date,
  stripe_account_id text,
  stripe_charges_enabled boolean default false,
  stripe_platform_customer_id text, -- added: Pro plan billing lives on the platform account
  twilio_subaccount_sid text,
  sms_sender text,
  sms_status text default 'none' check (sms_status in ('none','pending','approved','rejected')),
  sms_status_detail text, -- added: rejection reason shown in settings
  sms_verification jsonb, -- added: prefilled toll-free verification payload (EIN last 4 only)
  business_legal_name text,
  ein_last4 text,
  address jsonb,
  contact_email text, -- added: reply-to and owner alerts
  contact_phone text, -- added: HELP reply
  rate_card jsonb not null default '{}',
  created_at timestamptz default now()
);

create table membership (
  tenant_id uuid references tenant on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','dispatcher','viewer')),
  primary key (tenant_id, user_id)
);

create table crew_member (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant,
  name text not null,
  phone_e164 text,
  email text,
  kind text not null check (kind in ('employee','sub')),
  language text not null default 'en',
  sub_rate_card jsonb,
  active boolean default true,
  invite_token_hash text, -- added: /join/{token}
  joined_at timestamptz, -- added
  callout_reply text, -- added: last YES/NO reply, shown on the dashboard
  callout_reply_at timestamptz, -- added
  created_at timestamptz default now()
);

create table customer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant,
  name text not null,
  kind text not null check (kind in ('residential','commercial','hoa')),
  contact_name text,
  phone_e164 text,
  email text,
  billing_mode text not null default 'card_on_file' check (billing_mode in ('card_on_file','ach_on_file','invoice_net30','manual')),
  stripe_customer_id text,
  stripe_payment_method_id text,
  notify_sms boolean default false,
  notify_email boolean default true,
  created_at timestamptz default now()
);

create table site (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant,
  customer_id uuid not null references customer,
  label text not null,
  address text not null,
  lat double precision not null,
  lon double precision not null,
  nws_office text,
  nws_grid_x int,
  nws_grid_y int,
  nws_station text, -- added: nearest observation station
  nws_mapped_at timestamptz,
  parcel_id text,
  parcel_county text,
  area_estimate_sqft numeric,
  area_confirmed_sqft numeric,
  polygons jsonb, -- GeoJSON MultiPolygon
  walk_lf numeric,
  priority int not null default 3,
  service_window jsonb, -- {open_by:"06:00", days:[...]}
  notes text,
  active boolean default true,
  created_at timestamptz default now()
);

create table site_pin (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null references site,
  kind text check (kind in ('stake','pile','ada','entrance','hazard','other')),
  lat double precision,
  lon double precision,
  note text,
  photo_path text,
  created_at timestamptz default now()
);

create table contract (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null references site,
  season text not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','void')),
  services jsonb not null,
  salt_pricing jsonb,
  terms_md text,
  accepted_at timestamptz,
  accepted_name text,
  accepted_ip inet,
  pdf_path text,
  quote_token_hash text,
  installments_billed int not null default 0, -- added: seasonal installment progress
  created_at timestamptz default now()
);

create table route (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  default_crew_id uuid references crew_member,
  created_at timestamptz default now()
);

create table route_stop (
  route_id uuid references route on delete cascade,
  site_id uuid references site,
  seq int not null,
  tenant_id uuid not null,
  primary key (route_id, site_id)
);

create table weather_snapshot (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('nws_grid','nws_alerts','nws_obs','nohrsc')),
  office text,
  grid_x int,
  grid_y int,
  station text,
  fetched_at timestamptz not null,
  last_modified timestamptz,
  request_url text not null,
  storage_path text not null,
  sha256 text not null,
  summary jsonb not null
);
create index weather_snapshot_cell on weather_snapshot (office, grid_x, grid_y, fetched_at desc);
create index weather_snapshot_source on weather_snapshot (source, fetched_at desc);

create table trigger_alert (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kind text check (kind in ('forecast','depth_report','nws_alert')),
  site_ids uuid[] not null,
  detail jsonb not null,
  snapshot_ids uuid[] not null default '{}',
  status text default 'open' check (status in ('open','dispatched','dismissed')),
  created_at timestamptz default now()
);

create table storm (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  started_at timestamptz not null,
  closed_at timestamptz,
  trigger_alert_id uuid references trigger_alert,
  status text not null default 'active' check (status in ('active','closed','billed')),
  forecast_snapshot_ids uuid[] default '{}',
  waived_flags text[] not null default '{}' -- added: owner-waived billing flags
);

create table storm_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  storm_id uuid not null references storm,
  route_id uuid references route,
  crew_id uuid references crew_member,
  pass int not null default 1,
  link_token_hash text not null,
  link_token_enc text, -- added: AES-GCM copy so the dashboard can show QR and copy-link after publish
  link_expires_at timestamptz not null,
  link_revoked_at timestamptz, -- added: per-run revoke (ADDENDUM_DEVOPS section 6)
  published_at timestamptz,
  started_at timestamptz, -- added: first driver action, for "sub not started"
  created_at timestamptz default now()
);
create unique index storm_run_token on storm_run (link_token_hash);

create table run_stop (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  storm_run_id uuid not null references storm_run,
  site_id uuid not null references site,
  seq int not null,
  status text not null default 'open' check (status in ('open','enroute','onsite','done','skipped','problem')),
  previous_run_ids uuid[] not null default '{}', -- added: an offline driver can still sync a stop moved away from them
  updated_at timestamptz default now()
);
create index run_stop_run on run_stop (storm_run_id, seq);

create table visit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_uuid uuid not null unique,
  storm_id uuid not null references storm,
  run_stop_id uuid references run_stop,
  site_id uuid not null references site,
  crew_id uuid not null references crew_member,
  services text[] not null,
  arrived_device_at timestamptz not null,
  departed_device_at timestamptz,
  arrived_received_at timestamptz not null default now(),
  departed_received_at timestamptz,
  arrive_lat double precision,
  arrive_lon double precision,
  arrive_acc_m real,
  depart_lat double precision,
  depart_lon double precision,
  depth_in numeric,
  salt jsonb,
  notes text,
  voice_path text,
  gps_match boolean,
  is_replow boolean default false
);
create index visit_storm on visit (storm_id);
create index visit_site on visit (site_id, arrived_device_at);

create table visit_photo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  visit_id uuid not null references visit,
  client_uuid uuid not null unique,
  phase text check (phase in ('before','after','issue')),
  storage_path text not null,
  sha256 text not null,
  width int,
  height int,
  taken_device_at timestamptz,
  received_at timestamptz default now(),
  exif jsonb
);
create index visit_photo_visit on visit_photo (visit_id);

create table visit_correction (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  visit_id uuid not null references visit,
  field text not null check (field in ('voided','salt','is_replow','services','depth_in','notes')),
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  by_user uuid, -- spec says not null; a driver "Undo last" has no user, so by_crew is set instead
  by_crew uuid references crew_member,
  client_uuid uuid unique,
  created_at timestamptz default now(),
  check (by_user is not null or by_crew is not null)
);
create index visit_correction_visit on visit_correction (visit_id);

create table problem_report (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_uuid uuid unique,
  storm_run_id uuid,
  site_id uuid,
  crew_id uuid,
  kind text check (kind in ('blocked','breakdown','skip','damage','other')),
  note text,
  voice_path text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table invoice_draft (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  storm_id uuid not null references storm,
  customer_id uuid not null references customer,
  lines jsonb not null,
  subtotal_cents int not null,
  flags jsonb not null default '[]',
  status text default 'draft' check (status in ('draft','approved','charged','sent','paid','failed','void')),
  status_detail text, -- added: why it failed or waits
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  pay_link text, -- added
  disputed boolean not null default false, -- added: charge.dispute.created
  application_fee_cents int,
  created_at timestamptz default now(),
  unique (storm_id, customer_id)
);

-- added: seasonal installments and other non-storm invoices
create table installment_invoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contract_id uuid not null references contract,
  seq int not null,
  amount_cents int not null,
  stripe_invoice_id text,
  status text not null default 'sent',
  created_at timestamptz default now(),
  unique (contract_id, seq)
);

create table message_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel text check (channel in ('sms','email')),
  to_addr text not null,
  template text not null,
  body text not null,
  related jsonb,
  provider_id text,
  status text,
  idempotency_key text not null,
  created_at timestamptz default now(),
  unique (tenant_id, idempotency_key)
);

create table sms_consent (
  tenant_id uuid not null,
  phone_e164 text not null,
  party text check (party in ('crew','customer')),
  opted_in_at timestamptz,
  opted_in_source text,
  opted_out_at timestamptz,
  primary key (tenant_id, phone_e164)
);

create table proof_packet (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  site_id uuid not null,
  from_ts timestamptz not null,
  to_ts timestamptz not null,
  pdf_path text not null,
  sha256 text not null,
  manifest jsonb not null,
  manifest_sha256 text, -- added: hash of the manifest, distinct from the PDF bytes
  created_by uuid,
  created_at timestamptz default now()
);

create table job (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null,
  run_at timestamptz default now(),
  attempts int default 0,
  max_attempts int default 8,
  locked_until timestamptz,
  last_error text,
  done_at timestamptz,
  dead_at timestamptz, -- added: dead letter
  dedupe_key text unique
);
create index job_ready on job (run_at) where done_at is null and dead_at is null;

create table stripe_event (
  id text primary key,
  type text not null,
  received_at timestamptz default now(),
  processed_at timestamptz
);

create table lead (
  id uuid primary key default gen_random_uuid(),
  source text,
  email text not null,
  business text,
  payload jsonb,
  created_at timestamptz default now()
);

-- Added tables --------------------------------------------------------------

-- Every driver action exactly as received. This is the idempotency ledger for the outbox.
create table driver_action (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_uuid uuid not null unique,
  storm_run_id uuid not null references storm_run,
  run_stop_id uuid,
  kind text not null,
  payload jsonb not null,
  device_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table driver_position (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  storm_run_id uuid not null references storm_run,
  crew_id uuid,
  lat double precision not null,
  lon double precision not null,
  acc_m real,
  device_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index driver_position_run on driver_position (storm_run_id, device_at desc);

-- Own short links; carriers filter public shorteners.
create table short_link (
  code text primary key,
  tenant_id uuid not null,
  target text not null, -- absolute path, or photo:{visit_photo id}
  created_at timestamptz default now()
);

create table cached_lookup (
  key text primary key,
  value jsonb not null,
  fetched_at timestamptz not null default now()
);

create table app_setting (
  key text primary key,
  value jsonb not null
);

-- Circuit breaker state for the weather poller.
insert into app_setting (key, value) values ('weather_breaker', '{"failures":0,"open_until":null}');
