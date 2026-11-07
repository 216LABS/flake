# Addendum — Environments, Seed, Testing, Mock Mode (v1.0)

## 1. Environments
- `local`: Supabase CLI (Postgres + Auth + Storage), `PROVIDERS_MODE=mock`, `/dev/*` pages enabled (inbox, weather clock, impersonate driver link).
- `staging`: a Vercel preview + separate Supabase project, Stripe **test** mode, Twilio test credentials or mock, the real NWS (it's free) with the real User-Agent. `APP_ENV != production` hard-blocks live charges and real SMS even if live keys are present.
- `production`: Vercel project `flake` (domain flake.216labs.dev), Supabase prod, Stripe live, Twilio live. `/dev/*` routes return 404.
- Cron: Supabase `pg_cron` + `pg_net` call GET `/api/cron/{jobs,late-check,weather,reports,nohrsc}` with `Authorization: Bearer <CRON_SECRET>` (`packages/db/sql/schedule_jobs.sql`). `apps/web/vercel.json` has no cron entries, because Vercel Hobby rejects sub-daily schedules at deploy time. Local and mock mode keep the in-process ticker in `instrumentation.ts` when pg_cron is not scheduled.

## 2. Seed: demo tenant "Lakeshore Plow Co. (Demo)"
- Clearly fake company, owner `demo@flake.test`, dispatcher, 3 employees + 1 sub (fake names, 555-01xx phone numbers).
- 24 sites at real **public/commercial-looking but fictional-labeled** coordinates in Lakewood, Rocky River and Cleveland's west side. Use street-level points (e.g. along Detroit Ave, Madison Ave, Clifton Blvd, Warren Rd in Lakewood; Detroit Rd in Rocky River). Labels are generic ("Madison Ave Retail Lot", "Clifton Blvd Condo HOA", "Residential – Bunts Rd #12"). Don't use real business names or real homeowner data.
- A mix: 8 residential driveways (per_push $45–65, trigger 2"), 10 commercial lots (per_inch_tier or per_event, trigger 1–2", salt per 50 lb bag $18), 4 HOA (seasonal $2,400–6,000 in 5 installments), 2 hourly loader sites.
- 3 routes (West Lakewood, East Lakewood + Cleveland west, Rocky River) and the synthetic weather fixtures from ADDENDUM_WEATHER §6.
- One completed historical storm with visits, photos (generated placeholder images clearly watermarked "DEMO"), billing drafts with 3 flags, and one proof packet.
- `pnpm seed:demo` is idempotent.

## 3. Mock mode for every third party
Weather, parcel, footprints, OSM, geocoder, tiles (static placeholder tile), SMS, email, Stripe, PDF (real react-pdf works offline). Toggle with `PROVIDERS_MODE`. Each mock is deterministic for tests.

## 4. Testing strategy
See BUILD_SPEC §9. One command: `pnpm verify`. Playwright runs against `next build && next start` with mocks and local Supabase. RLS tests run against the real local Postgres (no mocking of RLS). The coverage gate is on packages/core only.

## 5. Observability and ops
Sentry (web + server), structured logs with tenant_id and job id (no tokens/PII bodies), a `/settings/system` page for dead-letter jobs and the weather circuit-breaker state, and daily Supabase backups (Pro). Photo storage estimate: ~1.5 MB × 2 photos × 30 sites × 20 storms ≈ 1.8 GB/tenant/season [J].

## 6. Security
Link tokens are 32 bytes random, stored as an HMAC-SHA256 hash, expire at storm close + 24 h, and can be revoked per run. Rate limits on `/api/d/*` and the public tools. CSP. Signed URLs for photos. Gitleaks in CI. No secrets in the repo (it is PUBLIC).

## 7. CI (add at the END of the build only)
GitHub Actions on PR/main: install → `pnpm verify`. Not used as a mid-build feedback loop.
