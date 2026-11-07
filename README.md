# Flake by 216LABS

Snow plow operations software for small plow companies: weather-triggered storm dispatch, a no-install driver check-in, automatic proof of service, and one-click billing. The software is free and earns a small cut of payments.

## Run it

Needs Node 20+, pnpm 10 and Docker. No API keys.

```sh
pnpm i
pnpm db:start     # local Supabase on ports 553xx, and writes apps/web/.env.local
pnpm seed:demo    # the Lakeshore Plow Co. (Demo) tenant; safe to re-run
pnpm dev          # http://localhost:3000
```

Open `/login` and choose **Use the demo company**. `/dev` has the driver links, `/dev/inbox` shows every message the mocks would have sent, and `/dev/weather` moves a fake clock through synthetic weather so you can fire a trigger.

## Check it

`pnpm verify` runs typecheck, lint, unit, RLS against real Postgres, integration, and Playwright e2e in mock mode. It resets the local database and leaves the e2e data behind, so run `pnpm db:reset && pnpm seed:demo` for a clean demo afterwards.

## Layout

```text
apps/web            Next.js: marketing, office app, driver PWA, API, cron
packages/core       Pure engines: pricing, triggers, billing flags, area, proof manifest, fees
packages/db         Drizzle schema, SQL migrations, RLS policies, RLS tests
packages/contracts  zod schemas
packages/providers  Weather, parcel, footprint, OSM, geocoder, tiles, SMS, email, payments, PDF: real + mock
packages/ui         UI kit and the driver big-button kit
docs/               Specs and research
```

## Modes

`PROVIDERS_MODE=mock` runs everything with no keys. `PROVIDERS_MODE=live` uses the real providers. Outside `APP_ENV=production`, real SMS and live Stripe keys are hard-blocked even if present. `/dev/*` returns 404 in production.

Environment variable names are in `.env.example`. Never commit values: this repo is public.

## Specs

`PROMPT_FULL_BUILD.md`, `docs/PLAN.md`, `docs/BUILD_SPEC.md`, `docs/ADDENDUM_*.md`, `docs/DECISIONS.md`, `docs/WISHLIST.md`, `docs/UX_BLUEPRINT.md`.
