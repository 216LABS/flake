# Flake — BUILD_SPEC (v1.0, 2026-11-06)
Read with PLAN.md, DECISIONS.md and all ADDENDUM_*.md. **[V]** marks a researched fact, **[J]** a design choice, and **[T]** something to verify against current provider docs during integration.

## 0. Non-negotiable rules
1. Strict TypeScript everywhere. Validate every API input with zod.
2. Tenant isolation end to end: RLS on every tenant table, storage paths prefixed `{tenant_id}/`, driver link tokens scoped to tenant + storm_run + driver, Stripe and Twilio objects mapped per tenant.
3. Visit records are **append-only**. Corrections are new rows that reference the original (`visit_correction`). Device time and server-received time are both stored. Nobody can edit timestamps or GPS.
4. Every external call goes through a provider interface with a **mock implementation**. `PROVIDERS_MODE=mock` (default in local/test) runs the whole app with no keys.
5. Idempotency: client UUIDs on driver actions, idempotency keys on Stripe calls and outbound messages, unique constraints on webhook event ids.
6. Store timestamps as UTC `timestamptz`. The UI shows the tenant's time zone (default America/New_York).
7. Never fabricate weather, reviews, customers or testimonials. Missing data renders as "unavailable."
8. No secrets in client bundles, logs or fixtures. Webhook signatures are verified on the raw body.
9. Accessibility: driver UI tap targets ≥ 60 px, contrast ≥ 7:1 in night mode, no hover-only controls.

## 1. Monorepo
```text
flake/
  apps/web/                 # Next.js App Router: marketing, app, driver PWA, API, cron
    app/(marketing)/        # /, /pricing, /tools/snow-removal-contract, /tools/snow-removal-pricing-calculator, /legal/*
    app/(app)/              # /dashboard, /storms/[id], /customers, /sites/[id], /routes, /billing, /proof, /settings
    app/d/[token]/          # driver PWA (no login), manifest + service worker
    app/q/[token]/          # customer quote/contract accept + card/ACH setup
    app/api/                # REST + webhooks + cron
  packages/db/              # Drizzle schema, SQL migrations, RLS policies, seed, RLS tests
  packages/contracts/       # zod schemas + shared types
  packages/providers/       # weather, parcel, footprint, geocode, tiles, sms, email, payments, pdf: interface + real + mock
  packages/core/            # pricing engine, trigger engine, billing engine, area estimator, proof assembler (pure, unit-tested)
  packages/ui/              # shadcn components, driver big-button kit
  docs/                     # these specs
```
Tooling: pnpm, Turborepo, Vitest (unit/integration), Playwright (e2e, mobile viewport), Supabase CLI (local DB), ESLint + Prettier, `tsc --noEmit`.

## 2. Data model (Postgres / Supabase)
Every tenant table has `tenant_id uuid not null`, RLS enabled, and `created_at timestamptz default now()`. A helper `auth_tenant_ids()` returns the tenants of the current user from `membership`.

```sql
create table tenant (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null,
  timezone text not null default 'America/New_York', plan text not null default 'free' check (plan in ('free','pro')),
  free_season_until date, stripe_account_id text, stripe_charges_enabled boolean default false,
  twilio_subaccount_sid text, sms_sender text, sms_status text default 'none' check (sms_status in ('none','pending','approved','rejected')),
  business_legal_name text, ein_last4 text, address jsonb, rate_card jsonb not null default '{}', created_at timestamptz default now());
create table membership (tenant_id uuid references tenant on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','dispatcher','viewer')), primary key (tenant_id,user_id));
create table crew_member (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenant,
  name text not null, phone_e164 text, email text, kind text not null check (kind in ('employee','sub')),
  language text not null default 'en', sub_rate_card jsonb, active boolean default true, created_at timestamptz default now());
create table customer (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenant,
  name text not null, kind text not null check (kind in ('residential','commercial','hoa')),
  contact_name text, phone_e164 text, email text, billing_mode text not null default 'card_on_file'
  check (billing_mode in ('card_on_file','ach_on_file','invoice_net30','manual')), stripe_customer_id text,
  stripe_payment_method_id text, notify_sms boolean default false, notify_email boolean default true, created_at timestamptz default now());
create table site (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenant,
  customer_id uuid not null references customer, label text not null, address text not null,
  lat double precision not null, lon double precision not null, nws_office text, nws_grid_x int, nws_grid_y int, nws_mapped_at timestamptz,
  parcel_id text, parcel_county text, area_estimate_sqft numeric, area_confirmed_sqft numeric, polygons jsonb, -- GeoJSON MultiPolygon
  walk_lf numeric, priority int not null default 3, service_window jsonb, -- {open_by:"06:00", days:[...]}
  notes text, active boolean default true, created_at timestamptz default now());
create table site_pin (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, site_id uuid not null references site,
  kind text check (kind in ('stake','pile','ada','entrance','hazard','other')), lat double precision, lon double precision,
  note text, photo_path text, created_at timestamptz default now());
create table contract (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, site_id uuid not null references site,
  season text not null, status text not null default 'draft' check (status in ('draft','sent','accepted','void')),
  services jsonb not null, -- [{service:'plow'|'salt'|'walks'|'haul', trigger_in:2, pricing:{type:'per_push',amount_cents:6500} ...}]
  salt_pricing jsonb, terms_md text, accepted_at timestamptz, accepted_name text, accepted_ip inet, pdf_path text,
  quote_token_hash text, created_at timestamptz default now());
create table route (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null,
  default_crew_id uuid references crew_member, created_at timestamptz default now());
create table route_stop (route_id uuid references route on delete cascade, site_id uuid references site, seq int not null,
  tenant_id uuid not null, primary key (route_id, site_id));
create table weather_snapshot (id uuid primary key default gen_random_uuid(), source text not null, -- nws_grid|nws_alerts|nws_obs|nohrsc
  office text, grid_x int, grid_y int, station text, fetched_at timestamptz not null, last_modified timestamptz,
  request_url text not null, storage_path text not null, sha256 text not null, summary jsonb not null);
  -- shared (not tenant-scoped); read via security-definer view for tenant's cells only
create table trigger_alert (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  kind text check (kind in ('forecast','depth_report','nws_alert')), site_ids uuid[] not null, detail jsonb not null,
  snapshot_ids uuid[] not null default '{}', status text default 'open' check (status in ('open','dispatched','dismissed')),
  created_at timestamptz default now());
create table storm (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null,
  started_at timestamptz not null, closed_at timestamptz, trigger_alert_id uuid references trigger_alert,
  status text not null default 'active' check (status in ('active','closed','billed')), forecast_snapshot_ids uuid[] default '{}');
create table storm_run (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, storm_id uuid not null references storm,
  route_id uuid references route, crew_id uuid references crew_member, pass int not null default 1,
  link_token_hash text not null, link_expires_at timestamptz not null, published_at timestamptz, created_at timestamptz default now());
create table run_stop (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, storm_run_id uuid not null references storm_run,
  site_id uuid not null references site, seq int not null, status text not null default 'open'
  check (status in ('open','enroute','onsite','done','skipped','problem')), updated_at timestamptz default now());
create table visit (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, client_uuid uuid not null unique,
  storm_id uuid not null references storm, run_stop_id uuid references run_stop, site_id uuid not null references site,
  crew_id uuid not null references crew_member, services text[] not null, arrived_device_at timestamptz not null,
  departed_device_at timestamptz, arrived_received_at timestamptz not null default now(), departed_received_at timestamptz,
  arrive_lat double precision, arrive_lon double precision, arrive_acc_m real, depart_lat double precision, depart_lon double precision,
  depth_in numeric, salt jsonb, -- [{unit:'bag50lb',qty:3}]
  notes text, voice_path text, gps_match boolean, is_replow boolean default false);
create table visit_photo (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, visit_id uuid not null references visit,
  client_uuid uuid not null unique, phase text check (phase in ('before','after','issue')), storage_path text not null, sha256 text not null,
  width int, height int, taken_device_at timestamptz, received_at timestamptz default now(), exif jsonb);
create table visit_correction (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, visit_id uuid not null references visit,
  field text not null, old_value jsonb, new_value jsonb, reason text not null, by_user uuid not null, created_at timestamptz default now());
create table problem_report (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, client_uuid uuid unique,
  storm_run_id uuid, site_id uuid, crew_id uuid, kind text check (kind in ('blocked','breakdown','skip','damage','other')),
  note text, voice_path text, resolved_at timestamptz, created_at timestamptz default now());
create table invoice_draft (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, storm_id uuid not null references storm,
  customer_id uuid not null references customer, lines jsonb not null, subtotal_cents int not null, flags jsonb not null default '[]',
  status text default 'draft' check (status in ('draft','approved','charged','sent','paid','failed','void')),
  stripe_payment_intent_id text, stripe_invoice_id text, application_fee_cents int, created_at timestamptz default now(),
  unique (storm_id, customer_id));
create table message_log (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, channel text check (channel in ('sms','email')),
  to_addr text not null, template text not null, body text not null, related jsonb, provider_id text, status text,
  idempotency_key text not null, created_at timestamptz default now(), unique (tenant_id, idempotency_key));
create table sms_consent (tenant_id uuid not null, phone_e164 text not null, party text check (party in ('crew','customer')),
  opted_in_at timestamptz, opted_in_source text, opted_out_at timestamptz, primary key (tenant_id, phone_e164));
create table proof_packet (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, site_id uuid not null,
  from_ts timestamptz not null, to_ts timestamptz not null, pdf_path text not null, sha256 text not null,
  manifest jsonb not null, created_by uuid, created_at timestamptz default now());
create table job (id bigserial primary key, kind text not null, payload jsonb not null, run_at timestamptz default now(),
  attempts int default 0, max_attempts int default 8, locked_until timestamptz, last_error text, done_at timestamptz,
  dedupe_key text unique);
create table stripe_event (id text primary key, type text not null, received_at timestamptz default now(), processed_at timestamptz);
create table lead (id uuid primary key default gen_random_uuid(), source text, email text not null, business text, payload jsonb, created_at timestamptz default now());
```
**RLS:** for each tenant table, `using (tenant_id in (select auth_tenant_ids()))`. Viewers can only read (enforced through policies per command). Driver PWA requests never use a Supabase user. They go through `/api/d/*` with a link token: the server hashes it, looks up `storm_run`, and uses the service role **with an explicit tenant_id filter in every query** (enforced by a `driverScope()` helper plus tests). `visit`, `visit_photo` and `weather_snapshot` have no UPDATE/DELETE policies for anyone (append-only). Storage buckets `photos`, `proof`, `contracts`, `weather-archive` are private, and reads go through signed URLs with a 10-minute TTL.

## 3. API routes (all zod-validated)
- Office (Supabase session): CRUD `/api/customers`, `/api/sites`, `/api/contracts`, `/api/routes`, `/api/crew`.
- `POST /api/sites/measure` {lat,lon} → {parcel, footprints, osmParking, estimateSqft, suggestedPolygon}
- `POST /api/quotes` → creates a contract plus a quote link
- `POST /api/storms` {name, routeIds, crewAssignments, triggerAlertId?} → storm + runs (draft)
- `POST /api/storms/:id/publish` → sends route links
- `PATCH /api/run-stops/:id` (reassign, reorder, skip)
- `POST /api/storms/:id/notify` {siteIds, template}
- `POST /api/storms/:id/close`
- `GET /api/storms/:id/live` (SSE or 5 s polling; Supabase Realtime on `run_stop` and `visit` is preferred)
- `POST /api/storms/:id/billing/draft` → invoice drafts plus flags
- `POST /api/billing/approve` {draftIds}
- `GET /api/billing/export.csv?storm=` (QuickBooks Online import format)
- `POST /api/proof` {siteId, from, to} → job → PDF
- `GET /api/proof/:id`
- Driver (link token): `GET /api/d/:token/run`, `POST /api/d/:token/actions` (batch of outbox actions: arrive|depth|photo_meta|salt|done|problem|undo_last), `POST /api/d/:token/photos` (multipart, client_uuid), `POST /api/d/:token/position` (only while the page is foreground).
- Customer (quote token): `GET /api/q/:token`, `POST /api/q/:token/accept` {name, consentSms, consentEmail}, `POST /api/q/:token/setup-intent`.
- Webhooks: `/api/webhooks/stripe` (account.updated, payment_intent.*, invoice.*, setup_intent.succeeded), `/api/webhooks/twilio/status`, `/api/webhooks/twilio/inbound` (STOP/HELP/START), `/api/webhooks/twilio/tollfree` (verification status).
- Public tools: `POST /api/tools/contract` → PDF plus lead capture; `POST /api/tools/price` → estimate plus optional lead.
- Cron (Vercel Cron with `CRON_SECRET`): `/api/cron/weather` (every 15 min; schedules per-cell fetch jobs), `/api/cron/jobs` (every 1 min; drains `job`), `/api/cron/nohrsc` (every 6 h), `/api/cron/late-check` (every 5 min during active storms), `/api/cron/reports` (every 15 min; completion reports).

## 4. Background jobs
| kind | what it does |
|---|---|
| `weather.fetch_cell` | Conditional GET of NWS grid → archive raw → snapshot → evaluate triggers for sites in the cell |
| `weather.fetch_alerts` | Active alerts per tenant service-area centroid |
| `weather.nohrsc` | Download the latest 6/24 h GeoTIFF, sample at site points, store snapshot summary |
| `trigger.evaluate` | ADDENDUM_WEATHER §3 rules → `trigger_alert` + notify the owner (SMS/email/push) |
| `storm.publish_links` | Generate per-run tokens, send SMS/email to crew |
| `notify.customer` | On the way / done / late (idempotent per visit+template) |
| `storm.late_check` | Flag run_stops past their service_window, alert the dispatcher |
| `billing.charge` | Off-session PaymentIntent or Stripe invoice per approved draft |
| `proof.render` | Assemble manifest → react-pdf → hash → store |
| `report.completion` | Email the per-visit completion report to commercial customers within 30 min of done |
| `photo.process` | Verify sha256, extract EXIF time/GPS, generate a thumbnail; the original is never altered |
| `sms.tollfree_submit` | Submit the toll-free verification for a tenant (ADDENDUM_SMS) |
Jobs are claimed with `FOR UPDATE SKIP LOCKED`, a lease of 2 min, exponential backoff with jitter, and dead-lettered after `max_attempts` (visible in /settings/system).

## 5. Core engines (packages/core, pure functions with full unit tests)
- **pricing.ts:** `priceVisit(contractService, visit, stormContext)` handles per_push (×pushes), per_inch_tier (tiers by storm depth = max(driver depth, NOHRSC 24 h at site, NWS elapsed)), per_event (once per storm per site), seasonal (no per-visit charge; installments on schedule), hourly (departed−arrived rounded up to 15 min), and salt by unit. Output is lines with `source_visit_ids`.
- **trigger.ts:** see ADDENDUM_WEATHER.
- **billing.ts:** `draftInvoices(storm)` produces one draft per customer with lines and flags: `missing_visit` (site in storm runs, not done/skipped), `duplicate` (2 done visits <60 min apart, not is_replow), `no_gps_match` (arrive point >150 m from polygon/centroid), `no_after_photo`, `missing_salt_qty` (salt service with no qty), `seasonal_info` (no charge). A draft with no flags is auto-ready.
- **area.ts:** ADDENDUM_WEATHER sibling logic in DECISIONS D4: estimate = OSM parking ∩ parcel, else (parcel − footprints) × ratio. Polygon area uses geodesic area (turf).
- **proof.ts:** builds a manifest {site, contract terms, storms[], visits[] with photo hashes, weather snapshots with hashes, messages} plus the hash of the manifest.

## 6. Screens and acceptance criteria
### 6.1 Driver PWA `/d/[token]` (from UX_BLUEPRINT)
- Opens with no login from an SMS/email link or QR. Works in iOS Safari 16+ and Android Chrome 110+. Dark high-contrast "night" theme by default. EN/ES toggle.
- **Screen A, Route:** header (storm name, "6 of 14 done", sync badge). The big card is the next stop: address, priority, service window, notes, pin chips, site photo. Buttons: **Navigate** (opens Apple/Google Maps), **Arrive** (full-width, 72 px). The remaining stops are listed below, and tapping a stop sets it as next.
- **Screen B, On site:** **Before photo** (camera opens directly) → depth picker (0.5"–12+, big chips; required on the first stop of the storm, optional after) → services chips (pre-selected from contract) → salt stepper (unit from contract, +/- 64 px) → **After photo** → **Done** (full-width). Below that: **Problem** (blocked / breakdown / skip / damage + optional voice note) and **Undo last** (within 2 min; creates a correction record).
- Every action is written to the IndexedDB outbox first. The badge shows Saved (on phone), Sending, or Synced. Retries happen on online/visibility/15 s.
- Haptic (`navigator.vibrate`, where supported) plus a visual confirm on every action. No text input required anywhere.
- Geofence: while the page is open and a route is active, `watchPosition` (high accuracy only near the next stop; otherwise low) shows a "You're here — Arrive?" banner within 75 m. It never auto-records.
- **Acceptance:**
  - (a) A Playwright offline test: airplane mode, complete 3 stops with photos, reload the page, go online → all 3 visits and 6 photos are on the server exactly once.
  - (b) Tap targets ≥ 60 px (automated check).
  - (c) A complete stop takes ≤ 5 taps plus 2 photos.
  - (d) Expired or revoked token → a friendly "ask your dispatcher for a new link" screen.
  - (e) Photos stored at ≥ 2048 px on the long edge and original EXIF retained server-side.

### 6.2 Storm dashboard `/storms/[id]`
- Header: storm timer, forecast vs elapsed snowfall (with source labels), done/open/late counts, buttons **Publish**, **Notify customers**, **Close storm**.
- The main area is columns per truck/run (a list, not a map): stop cards with status pill, ETA order, and time since arrival. Drag a card between columns, or use the tap menu "Move to…", to reassign, which notifies both drivers. Late priority sites float to the top in red.
- A right rail with alerts (problem reports, late sites, a sub not started 30 min after publish).
- A collapsible map (MapLibre): site pins by status, last driver positions.
- Live updates in under 5 s (Realtime).
- **Acceptance:** reassigning updates both drivers' PWA within 10 s; "Notify customers → running late" sends to the selected customers once (idempotent); closing a storm is blocked while stops are onsite (with a confirm-to-force option).

### 6.3 Trigger alert → storm in two taps
- When an alert fires, the owner gets an SMS/email/push: "Lakewood: 2.4" forecast by 5 AM, 18 sites at trigger. Review →". The `/alerts/[id]` page lists affected sites grouped by route, the suggested crew, and the forecast snapshot. **Start storm** creates the storm and runs, and **Publish** sends the links.
- **Acceptance:** alert to links sent takes ≤ 2 taps after opening; the snapshot ids are attached to the storm.

### 6.4 One-click billing review `/billing?storm=`
- **Generate drafts** shows a table per customer: lines, total, flags. A **Show flagged only** filter is on by default. Each flag has inline fixes (mark skipped / add salt qty / mark re-plow / waive). The **Approve all clean** button is primary.
- Approve → card/ACH charge off-session or Stripe invoice (net-30), depending on the customer's billing_mode. The application fee is shown per line in the footer (owner-facing only).
- QBO CSV export.
- **Acceptance:**
  - (a) A seeded storm with 20 visits produces correct totals for all 5 pricing types (unit fixtures).
  - (b) The flag rules are unit-tested.
  - (c) Approve is idempotent (a double click charges once).
  - (d) A failed card → status failed, a pay link is emailed, and the dashboard shows it.

### 6.5 Proof packet `/proof`
- Pick a site and a date range (or "claim date ± 48 h"), then **Generate**. The PDF has:
  1. A cover: site, customer, contractor, period, generated-at, manifest sha256.
  2. Contract scope and trigger.
  3. A storm timeline per storm, with NWS forecast snapshots (issued time, forecast snowfall), alerts, and NOHRSC observed totals, each with its snapshot hash and source URL.
  4. A visit table: arrive/depart device and received times, GPS + accuracy, services, salt, depth, crew.
  5. Photo pages (before/after, timestamps, hashes).
  6. Customer messages sent.
  7. Corrections log.
  8. An appendix explaining the data sources.
- **Acceptance:** regenerating with the same inputs yields the same manifest hash; the PDF renders on a seeded site with 3 storms in under 20 s; any correction appears in the log.

### 6.6 New customer in under 15 minutes `/customers/new`
1. Name, kind, contact, phone/email.
2. Address (geocoded with autocomplete) → map on satellite with the **estimated** polygon and sqft (label it "Estimate — drag to adjust"). Draw or edit tools. Walks length tool.
3. Services and pricing: pick from the rate card. The suggested price = rate card × area tier (editable). Trigger depth defaults to 2" commercial and 2" residential (editable).
4. Pins: tap the map to drop stake/pile/ADA/entrance pins with an optional photo.
5. Add to route (choose route + position).
6. Send quote (email/SMS link) → the customer page `/q/[token]` shows the scope, price, terms, e-sign (typed name + checkbox), SMS/email notification consent checkboxes (unchecked by default), and card/ACH setup via Stripe Payment Element (SetupIntent on the connected account).
- **Acceptance:** a scripted e2e completes steps 1–6 with mocks in under 3 minutes of automated time. The manual target is under 15 min. Accepting stores the name, IP and timestamp, plus a contract PDF snapshot.

### 6.7 SEO tools (public, no login)
- `/tools/snow-removal-contract`: a form (company, client, site, season dates, services, trigger, pricing type, salt, liability/insurance clause, payment terms) → downloadable PDF. The email is optional (lead capture). It includes a disclaimer that it's not legal advice, and a footer CTA "Run this contract in Flake free."
- `/tools/snow-removal-pricing-calculator`: inputs are lot sqft or "measure my lot" (same estimator, address-based), walks LF, trigger, pricing type, local rate assumptions (editable defaults clearly labeled as assumptions, never presented as market data) → per push / per event / seasonal estimate.
- Both get SSR'd metadata, JSON-LD (SoftwareApplication / HowTo), and fast LCP.
- **Acceptance:** Lighthouse SEO ≥ 95, and the PDF generates without an account.

### 6.8 Settings
Rate card, crew (invite via SMS/email; consent captured), routes editor (drag order), Stripe connect onboarding (Account Link), SMS sender status (pending/approved), the business info required for toll-free verification, plan/billing, data export (CSV of all tables for the tenant), and a system jobs page.

### 6.9 Marketing pages
`/` (promise, how it works in 3 steps, the free first season, honest "in early testing" note, no testimonials), `/pricing`, `/legal/terms`, `/legal/privacy` (including an SMS section: no mobile info shared with third parties for marketing), `/legal/sms-terms`.

## 7. Integrations (interfaces in packages/providers)
`WeatherProvider` (nws, nohrsc, mock), `ParcelProvider` (cuyahoga, summit, lorain, lake, medina, mock), `FootprintProvider` (overture-local-extract or mock), `OsmProvider` (Overpass API, mock), `Geocoder` (Census Geocoder, free, or mock; Mapbox optional), `TileProvider`, `SmsProvider` (twilio, mock that writes to message_log and a dev inbox page `/dev/inbox`), `EmailProvider` (Resend or mock), `PaymentsProvider` (stripe, mock), `PdfRenderer`.
Each one has a contract test suite that runs against the mock always, and against the real provider only when `LIVE_PROVIDER_TESTS=1` plus keys are present.

## 8. Env vars (names only)
```
APP_ENV APP_BASE_URL PROVIDERS_MODE (mock|live) CRON_SECRET LINK_TOKEN_SECRET
NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL
NWS_USER_AGENT
STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_CONNECT_CLIENT_ID STRIPE_PRICE_PRO_MONTHLY STRIPE_PRICE_PRO_YEARLY
TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WEBHOOK_BASE_URL
RESEND_API_KEY EMAIL_FROM
MAPBOX_TOKEN (optional) OVERPASS_URL (optional)
SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN ADMIN_EMAILS
```

## 9. Testing (run once at the end; see PROMPT_FULL_BUILD.md)
- Unit: packages/core at 100% of branches for pricing, trigger, billing flags, area, proof manifest.
- DB/RLS: a pgTAP or Vitest suite against local Supabase. Tenant A can never read or write tenant B on every table. Driver scope can only touch its run. Append-only tables reject UPDATE/DELETE.
- Integration: API routes with mocks (storm lifecycle; billing idempotency; Stripe/Twilio webhooks with signed fixtures).
- E2E (Playwright, iPhone 13 + Pixel 7 viewports): onboarding a customer; trigger alert → publish; driver offline flow; billing approve; proof packet download.
- `pnpm verify` = typecheck + lint + unit + db + integration + e2e (mock mode). One command.
