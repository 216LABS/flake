# Deploying Flake to production

Production is the Vercel project `flake` on `flake.216labs.dev` with its own Supabase project. DNS for the domain already points at Vercel. Never run `pnpm seed:demo` against production.

## 1. Supabase
Create a project, then from `packages/db`:

```sh
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

In the Supabase dashboard:
- Auth, URL Configuration: set Site URL to `https://flake.216labs.dev` and add `https://flake.216labs.dev/**` to the redirect URLs.
- Auth, SMTP: add custom SMTP (Resend works). The built-in sender only allows a few emails an hour, which is not enough for magic links.
- Database, Connection string: copy the Transaction pooler URL (port 6543) for `DATABASE_URL`. The app connects with prepared statements off, so the pooler is safe.

## 2. Vercel
```sh
cd apps/web
vercel login
vercel link          # project: flake
vercel domains add flake.216labs.dev
```
In the project settings, set Root Directory to `apps/web` and leave "Include files outside the root directory" on.

**Cron needs Vercel Pro.** `apps/web/vercel.json` runs `/api/cron/jobs` every minute, and Hobby rejects that schedule at deploy time. Without Pro no background job runs: no links, charges, weather or PDFs.

## 3. Environment variables (Production)
Required to boot:

| Name | Value |
|---|---|
| `APP_ENV`, `NEXT_PUBLIC_APP_ENV` | `production` |
| `PROVIDERS_MODE`, `NEXT_PUBLIC_PROVIDERS_MODE` | `live` |
| `APP_BASE_URL` | `https://flake.216labs.dev` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
| `DATABASE_URL` | the pooler URL from step 1 |
| `CRON_SECRET`, `LINK_TOKEN_SECRET` | `openssl rand -hex 32`, one each |
| `NWS_USER_AGENT` | `(flake.216labs.dev, sam@216labs.dev)` |

`LINK_TOKEN_SECRET` must never change after launch. It hashes every driver and quote link and encrypts stored links, so changing it kills all of them.

Each of these turns a feature on. Until it's set, that feature refuses and says so, and never falls back to a mock:

| Feature | Names |
|---|---|
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL` |
| Errors | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Other counties | `PARCEL_URL_SUMMIT`, `PARCEL_URL_LORAIN`, `PARCEL_URL_LAKE`, `PARCEL_URL_MEDINA` |

`NEXT_PUBLIC_*` values are built into the page, so redeploy after changing them.

## 4. Deploy
```sh
vercel deploy --prod
```

## 5. Check it
Replace `$S` with `CRON_SECRET`.

```sh
curl -I https://flake.216labs.dev/                  # 200
curl -I https://flake.216labs.dev/dev               # 404
curl -H "Authorization: Bearer $S" https://flake.216labs.dev/api/cron/weather
curl -H "Authorization: Bearer $S" https://flake.216labs.dev/api/cron/jobs
```

Then sign in with a magic link, create your company, add a customer, start a storm, and open the route link on a real iPhone and a real Android phone. Run the offline flow: airplane mode, one stop with photos, reload, back online.

## 6. Webhooks
- Stripe: `https://flake.216labs.dev/api/webhooks/stripe`, with Connect events on. Events are listed in `docs/ADDENDUM_PAYMENTS.md`.
- Twilio: inbound, status and toll-free webhooks are set per number by the app, under `/api/webhooks/twilio/*`.

## Before real money
- Resolve the 216LABS tax ID with Stripe, then run one test-mode charge, one decline and one net-30 invoice from a staging deployment. None of the Stripe code has run against Stripe yet.
- Get Flake's Twilio Primary Customer Profile approved, then check the toll-free field names against Twilio's current docs.
- Have a lawyer read the three legal pages. They are marked as drafts.
- Confirm the OSM and Esri basemap terms.
