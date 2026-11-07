# Flake — full build, then test (paste this into Claude)

Build **Flake by 216LABS** from scratch in this repo (`216LABS/flake`) as ONE continuous implementation pass, then run ONE full verification pass at the end. Don't drip work through CI, don't open PRs just to wait on checks, don't set up Actions that re-run during the build, and don't stop mid-stream for feedback loops. Don't ask Flip questions mid-run. Choose reasonable defaults from the docs and list them in the final report.

## Specs (normative, in /docs)
- docs/PLAN.md: product, personas, scope (Must / Differentiators / Later), pricing, non-goals
- docs/BUILD_SPEC.md: monorepo, SQL schema + RLS, API routes, jobs, engines, screen-by-screen specs with acceptance criteria, env names, tests
- docs/ADDENDUM_WEATHER.md: NWS + NOHRSC, trigger engine, evidence archive
- docs/ADDENDUM_PAYMENTS.md: Stripe Connect direct charges + application fee, card/ACH on file, net-30 invoices
- docs/ADDENDUM_SMS_COMPLIANCE.md: Twilio subaccount + toll-free verification per tenant, consent, templates
- docs/ADDENDUM_DEVOPS.md: envs, Lakewood demo seed, mock mode, testing, security
- docs/DECISIONS.md: why each choice was made (sources)
- docs/WISHLIST.md, docs/UX_BLUEPRINT.md: the customer research behind the UX (follow its principles)

## Locked decisions
- Stack: TypeScript strict, Next.js App Router, pnpm + Turborepo, Tailwind + shadcn, Supabase (Postgres/Auth/Storage, RLS multi-tenant), Drizzle, Vercel + Vercel Cron, Stripe Connect, Twilio, Resend, react-pdf, MapLibre.
- The driver app is a **no-install PWA** opened from a signed link: an offline IndexedDB outbox, idempotent server, big glove-friendly buttons, night theme, EN/ES. No background GPS (iOS can't). Geofence is only a foreground prompt.
- Weather: NWS gridpoint `snowfallAmount` + alerts for forecasts, NOHRSC gridded snowfall for observed, driver depth reports. Every fetch is archived with sha256 as evidence. **No auto-dispatch:** the owner confirms with one tap.
- Visit records and weather snapshots are append-only. Corrections are separate rows.
- Payments: direct charges on connected accounts (account pays Stripe fees, Stripe owns losses) with an application fee of 1% (free) / 0.5% (Pro $79/mo), clamped $0.50–$25. Free first season through 2027-04-30.
- SMS only to consented numbers, from the tenant's own verified toll-free number. Email/QR fallback until verified.
- Every third party sits behind an interface with a deterministic mock. `PROVIDERS_MODE=mock` runs everything with no keys.
- No fake social proof, testimonials, customers, or weather values anywhere.

## How to work
1. Scaffold the monorepo once (apps/web, packages/db, contracts, providers, core, ui, docs, .env.example with names only, README).
2. Implement the FULL v1 (all M1–M10 and D1–D6 in PLAN.md) with real implementations + mocks: schema + RLS + seed, onboarding with auto-measure, contracts/quote acceptance with SetupIntent, routes, weather polling + triggers + archive, storm runs + driver PWA + live dashboard + customer notices, billing drafts/flags/approve/charge/invoice/QBO CSV, proof packet PDF, completion reports, SEO tools, marketing + legal pages, settings (Stripe onboarding, SMS verification status, rate card, crew invites), /dev pages.
3. Write unit/integration/e2e tests as you go, but DON'T stop to run CI.
4. When the implementation is substantially complete: run `pnpm verify` (typecheck, lint, unit, RLS/db, integration, Playwright e2e in mock mode) ONCE. Fix the failures, then re-run once to confirm green.
5. Add the GitHub Actions workflow only at the end (PR/main → `pnpm verify`).
6. Never commit secrets. The repo is PUBLIC.

## Success criteria
- `pnpm i && pnpm db:start && pnpm seed:demo && pnpm dev` runs the Lakewood demo tenant with no keys.
- The driver offline e2e passes (3 stops offline → synced exactly once).
- RLS tests prove tenant isolation and append-only visits.
- Billing produces correct totals for all 5 pricing types, approve is idempotent, and fees are correct.
- The proof packet PDF is deterministic (same manifest hash) and includes weather snapshot hashes.
- Acceptance criteria in BUILD_SPEC §6 are met or explicitly listed as not met with a reason.
- Final report: what was built, how to run it, what's blocked on live keys (Stripe live + the 216LABS tax ID, Twilio Primary Customer Profile, Resend domain, Vercel Pro cron), and any defaults you chose.
