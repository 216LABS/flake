# Deploying Flake

Two ways to run it. Start with the free plan path. Never run `pnpm seed:demo` against anything real people use.

## Free plan path

Vercel Hobby and a Supabase free project. Hobby rejects any cron that runs more than once a day, and it rejects the project at deploy time, so there is no `vercel.json` cron list. The `/api/cron/*` routes stay. Supabase calls them. Costs nothing and uses no paid accounts. Real weather, parcels, sign-in and phones; mock Stripe and SMS. `/dev/inbox` shows the texts that would have gone out, and a banner says it's a test.

| Piece | Service | Free plan limit that matters |
|---|---|---|
| App | Vercel Hobby | Non-commercial use only. About 4 hours of active CPU a month |
| Database, sign-in, photos | Supabase Free | 500 MB database, **1 GB of files**, pauses after a week with no activity |
| Background jobs | Supabase `pg_cron` | Free. A paused project does not fire jobs |
| Weather, parcels, geocoding | NWS, NOHRSC, Census, county GIS | Free |
| Email (optional) | Resend Free | 100 a day, needs a verified domain. Off until a key is set |

**What 1 GB means:** photos are kept at original size, about 3 MB each, so 1 GB holds roughly 150 visits with before and after photos. Settings, System shows the usage, and the dashboard warns at 80%. When storage fills, photos wait safely on the driver's phone, but they won't upload until there's room.

### 1. Supabase free project

Create a free project, then from `packages/db`:

```sh
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

`db push` applies the schema, RLS, and the advisor migration. Leave the `private` schema out of the Data API exposed schemas. It holds the security-definer helpers that RLS and triggers call.

In Auth, URL Configuration, set Site URL to the app URL and add `<app url>/**` to the redirect URLs.

**Sign-in email:** the built-in sender allows only a few emails an hour. Use Resend as the custom SMTP. In Authentication → Emails → SMTP settings:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key |
| Sender email | a verified Resend address, the same one as `EMAIL_FROM` |
| Sender name | `Flake` |

In the SQL editor, insert two Vault secrets. Do not commit either value. `app_base_url` is the public origin with no trailing slash. `cron_secret` is the same string as `CRON_SECRET` (`openssl rand -hex 32`).

```sql
select vault.create_secret('https://your-app.vercel.app', 'app_base_url', 'Public origin of the web app');
select vault.create_secret('<paste CRON_SECRET>', 'cron_secret', 'Bearer token for /api/cron routes');
```

To rotate one later, update the existing row rather than inserting a second name:

```sql
select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<new CRON_SECRET>');
```

Then schedule the jobs. Use the direct connection (port 5432) as `postgres`, not the transaction pooler on 6543. `pnpm db:schedule` is safe to re-run: it unschedules each job name, then schedules it again. Each run reads `app_base_url` and `cron_secret` from `vault.decrypted_secrets` and sends `Authorization: Bearer <cron_secret>`. `pnpm cron:install` runs the same script.

```sh
DATABASE_URL='postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres' pnpm db:schedule
```

| Job name | Cadence | What it calls |
|---|---|---|
| `flake-jobs` | every minute (`* * * * *`) | `GET /api/cron/jobs` |
| `flake-late-check` | every 5 minutes (`*/5 * * * *`) | `GET /api/cron/late-check` |
| `flake-weather` | every 15 minutes (`*/15 * * * *`) | `GET /api/cron/weather` |
| `flake-reports` | every 15 minutes (`*/15 * * * *`) | `GET /api/cron/reports` |
| `flake-nohrsc` | every 6 hours (`0 */6 * * *`) | `GET /api/cron/nohrsc` |
| `flake-prune-log` | daily at 03:30 UTC (`30 3 * * *`) | deletes `cron.job_run_details` older than 3 days |

Without this nothing in the background happens: no links, charges, weather or PDFs.

Database, Connection string: copy the transaction pooler URL (port 6543) for the app's `DATABASE_URL`. The app connects with prepared statements off, so the pooler is safe. Keep the direct URL from the schedule step out of Vercel.

### 2. Vercel Hobby, imported from GitHub

Import the GitHub repo. Set Root Directory to `apps/web`, turn on "Include source files outside of the Root Directory", and leave the framework as Next.js. There is no cron list to reject. The CLI does the same thing: from `apps/web`, `vercel login`, `vercel link`, then `vercel deploy --prod`. Use the `.vercel.app` URL, or add `flake.216labs.dev` if the domain lets you.

Environment variables for this free test deployment:

| Name | Value |
|---|---|
| `APP_ENV`, `NEXT_PUBLIC_APP_ENV` | `staging` |
| `PROVIDERS_MODE`, `NEXT_PUBLIC_PROVIDERS_MODE` | `live` |
| `APP_BASE_URL` | the same origin stored as Vault `app_base_url` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
| `DATABASE_URL` | the transaction pooler URL, port 6543 |
| `DB_POOL_MAX` | `3` |
| `CRON_SECRET` | the same value stored as Vault `cron_secret` |
| `LINK_TOKEN_SECRET` | `openssl rand -hex 32`, and never change it after launch |
| `NWS_USER_AGENT` | `(flake.216labs.dev, sam@216labs.dev)` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional; mail the app sends itself. Auth SMTP uses the API key as the SMTP password |

`NEXT_PUBLIC_*` values are built into the page, so redeploy after changing them. Feature keys beyond email (Stripe, Twilio, Sentry, parcel URLs) are in Real production below. Until one is set, that feature refuses and says so. On this staging deployment, Stripe and SMS stay mock.

### 3. Local and mock

`pnpm db:start` does not schedule pg_cron. If the local image has no pg_cron, leave it that way. With `APP_ENV=local` (not `staging` or `production`), `apps/web/instrumentation.ts` drains the job table every 2 seconds. `pnpm db:schedule` is for the hosted database, after the two Vault secrets exist.

### Try it

Sign in, create your company, add a customer and a route, start a storm, and open the route link on a real phone. Crew links show on the storm board as a QR code and copy-link.

## Real production

The same steps, with these changes:
- **Plans:** Vercel Pro, because Hobby's terms don't allow commercial use, and Supabase Pro for backups and storage. Background jobs stay on Supabase `pg_cron` either way.
- **`APP_ENV` and `NEXT_PUBLIC_APP_ENV`:** `production`. `/dev` then returns 404, mock providers are refused, and a missing Stripe or Twilio key makes that feature refuse rather than fake it.
- **Keys:**

  | Feature | Names |
  |---|---|
  | Email | `RESEND_API_KEY`, `EMAIL_FROM` |
  | Payments | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` |
  | SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL` |
  | Errors | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
  | Other counties | `PARCEL_URL_SUMMIT`, `PARCEL_URL_LORAIN`, `PARCEL_URL_LAKE`, `PARCEL_URL_MEDINA` |
  | Usage meter | `ADMIN_EMAILS`: who sees it in production |

- **Webhooks:** Stripe at `/api/webhooks/stripe` with Connect events on (listed in `docs/ADDENDUM_PAYMENTS.md`). The app sets the Twilio ones per number.
- **Jobs:** the same `pnpm db:schedule` after the Vault secrets match production `APP_BASE_URL` and `CRON_SECRET`.

`LINK_TOKEN_SECRET` must never change after launch. It hashes every driver and quote link, so changing it kills them all.

### Before real money
- Resolve the 216LABS tax ID with Stripe, then run one test-mode charge, one decline and one net-30 invoice. None of the Stripe code has run against Stripe yet.
- Get Flake's Twilio Primary Customer Profile approved, then check the toll-free field names against Twilio's current docs.
- Have a lawyer read the three legal pages. They are marked as drafts.
- Confirm the OSM and Esri basemap terms.
