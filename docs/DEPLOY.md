# Deploying Flake

Never run `pnpm seed:demo` against anything real people use.

## What production is today

| Piece | Service | Notes |
|---|---|---|
| App | Vercel Hobby | `APP_ENV=production`. Hobby's terms are non-commercial: move to Pro before Flake charges anyone. About 4 hours of active CPU a month |
| Database, sign-in, photos | Supabase Free | 500 MB database, **1 GB of files**, pauses after a week with no activity |
| Background jobs | Supabase `pg_cron` + `pg_net` | Calls the app's `/api/cron/*` routes. Hobby rejects sub-daily Vercel crons, so there is no `vercel.json` cron list |
| Weather, parcels, geocoding | NWS, NOHRSC, Census, county GIS | Free |
| Email | Resend Free | 100 a day, from a verified domain |
| Payments, texts | Stripe Connect, Twilio | **Off until their keys are set.** Production refuses mock providers, so each refuses and says so rather than faking |

**What 1 GB means:** photos are kept at original size, about 3 MB each, so 1 GB holds roughly 150 visits with before and after photos. Settings, System shows the usage, and the dashboard warns at 80%. When storage fills, photos wait safely on the driver's phone, but they won't upload until there's room.

## Setting it up from scratch

### 1. Supabase project

From `packages/db`:

```sh
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

`db push` applies the schema, RLS, the advisor migration, push subscriptions and salt ordering. Leave the `private` schema out of the Data API exposed schemas. It holds the security-definer helpers that RLS and triggers call.

In Auth, URL Configuration, set Site URL to the app URL and add `<app url>/**` to the redirect URLs.

**Sign-in email:** the built-in sender allows only a few emails an hour. Use Resend as the custom SMTP. In Authentication, Emails, SMTP settings:

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

### 2. Schedule the jobs (new projects only)

`pnpm db:schedule` applies `packages/db/sql/schedule_jobs.sql`. It is safe to re-run on a new project: it unschedules each job name, then schedules it again, and reads `app_base_url` and `cron_secret` from Vault when each job fires. Use the direct connection (port 5432) as `postgres`, not the transaction pooler on 6543. On an IPv4 network, use the session pooler string instead (also port 5432, user `postgres.<ref>`, host `aws-*.pooler.supabase.com`).

```sh
DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' pnpm db:schedule
```

**Don't run it against production casually.** Production is already scheduled to match this table. To change one job there, use `cron.alter_job` on that job alone (see Runbook below).

| Job name | Cadence | What it calls | pg_net timeout |
|---|---|---|---|
| `flake-jobs` | every 2 minutes (`*/2 * * * *`) | `GET /api/cron/jobs` | 15 s |
| `flake-late-check` | every 5 minutes (`*/5 * * * *`) | `GET /api/cron/late-check` | 30 s |
| `flake-weather` | every 15 minutes (`*/15 * * * *`) | `GET /api/cron/weather` | 30 s |
| `flake-reports` | every 15 minutes (`*/15 * * * *`) | `GET /api/cron/reports` | 30 s |
| `flake-nohrsc` | every 6 hours (`0 */6 * * *`) | `GET /api/cron/nohrsc` | 30 s |
| `flake-prune-log` | daily at 03:30 UTC (`30 3 * * *`) | deletes `cron.job_run_details` older than 3 days | |

Without these nothing in the background happens: no links, charges, weather or PDFs.

Database, Connection string: copy the transaction pooler URL (port 6543) for the app's `DATABASE_URL`. The app connects with prepared statements off, so the pooler is safe. Keep the direct URL out of Vercel.

### 3. Vercel, imported from GitHub

Import the GitHub repo. Set Root Directory to `apps/web`, turn on "Include source files outside of the Root Directory", and leave the framework as Next.js. From the CLI: in `apps/web`, `vercel login`, `vercel link`, then `vercel deploy --prod`.

| Name | Value |
|---|---|
| `APP_ENV`, `NEXT_PUBLIC_APP_ENV` | `production` (a Vercel production deployment with no `APP_ENV` is treated as production anyway) |
| `PROVIDERS_MODE`, `NEXT_PUBLIC_PROVIDERS_MODE` | `live` |
| `APP_BASE_URL` | the same origin stored as Vault `app_base_url` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
| `DATABASE_URL` | the transaction pooler URL, port 6543 |
| `DB_POOL_MAX` | `3` |
| `CRON_SECRET` | the same value stored as Vault `cron_secret` |
| `LINK_TOKEN_SECRET` | `openssl rand -hex 32`, and never change it after launch: it hashes every driver, quote and records link |
| `NWS_USER_AGENT` | `(flake.216labs.dev, sam@216labs.dev)` |
| `RESEND_API_KEY`, `EMAIL_FROM` | mail the app sends. Auth SMTP uses the same API key |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push alerts, below |
| `ADMIN_EMAILS` | who sees storage, scheduled calls and the salt admin |

`NEXT_PUBLIC_*` values are built into the page, so redeploy after changing them.

### Push alerts

Web Push needs no account and costs nothing. Run `npx web-push generate-vapid-keys` once and set the three `VAPID_*` values (`VAPID_SUBJECT` is `mailto:` plus your address). Never commit the private key, and don't change it later: every device would have to turn alerts on again. On iPhone, notifications need iOS 16.4 or newer and Flake added to the Home Screen.

## Turning on payments and texts

Both stay off until their keys exist. Use test mode first; production refuses nothing about test keys, so a full test-mode run can happen on the real deployment.

### Stripe Connect

1. In Stripe (test mode), turn on Connect. Flake creates accounts with the controller properties (account pays fees, Stripe owns losses, full Dashboard), so no platform profile questions beyond that.
2. Create two products' prices for Pro if you want the upgrade button: monthly and yearly.
3. Add **two** webhook endpoints, both to `<APP_BASE_URL>/api/webhooks/stripe`. Stripe gives each its own signing secret.

   | Endpoint | Listen to | Events |
   |---|---|---|
   | Your account | Events on your account | `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` |
   | Connected accounts | Events on connected accounts | `account.updated`, `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `charge.dispute.created` |

4. Set in Vercel and redeploy:

   | Name | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | `sk_test_...` (an `sk_live_` key is refused outside `APP_ENV=production`) |
   | `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
   | `STRIPE_WEBHOOK_SECRET` | the "your account" endpoint's `whsec_...` |
   | `STRIPE_CONNECT_WEBHOOK_SECRET` | the "connected accounts" endpoint's `whsec_...` |
   | `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` | the two `price_...` ids, optional |

A company connects from Settings, Payments. When they come back from Stripe, that page asks Stripe directly whether charges are on, so it doesn't wait on the webhook.

### Twilio

1. Get Flake's Primary Customer Profile approved in Twilio (Trust Hub). Each company gets its own subaccount and toll-free number, verified in its own legal name.
2. Set in Vercel and redeploy:

   | Name | Value |
   |---|---|
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | the main account's |
   | `TWILIO_WEBHOOK_BASE_URL` | only if Twilio should call a different origin than `APP_BASE_URL` |

3. Nothing to register by hand. When a company submits verification in Settings, Text messages, Flake makes its subaccount, buys a toll-free number, and points that number at `/api/webhooks/twilio/inbound` (STOP, HELP, YES/NO) and `/api/webhooks/twilio/status` (delivery). Those arrive signed with the subaccount's token, which Flake looks up from the main account. Verification results are polled every 15 minutes from `/api/cron/reports`; `/api/webhooks/twilio/tollfree` also accepts Twilio's status callback if you configure one.

Toll-free verification takes 3 to 5 business days per company. Until then crew links go by email, QR and copy-link, and customer notices go by email.

### Other optional keys

| Feature | Names |
|---|---|
| Errors | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Other counties | `PARCEL_URL_SUMMIT`, `PARCEL_URL_LORAIN`, `PARCEL_URL_LAKE`, `PARCEL_URL_MEDINA` |
| Storage meter limits | `STORAGE_LIMIT_MB` (default 1024), `DB_LIMIT_MB` (default 500) |

## How background jobs run

The queue needs no extra service. `pg_cron` calls `/api/cron/jobs` every 2 minutes. The route answers at once and drains the queue after the response, for up to 50 seconds.

- **Lanes.** Route links and alerts go first, then customer notices, then reports, then photos and proof packets. A job moves up one lane for every 10 minutes it waits.
- **Fair turns.** Inside a lane, companies take turns.
- **Instant urgent work.** Route links and alerts run right after the request that queued them, so they don't wait for the next run.
- **Adaptive speed.** A run starts one job at a time and works up to 4 at once, or to `DB_POOL_MAX` minus one if that is lower. Any failure drops it back to one.
- **Rate limits.** A 429 from Resend reschedules the job without using up an attempt.

**Every scheduled call is safe to miss or to run twice.** Jobs are claimed with row locks, and everything the other routes queue has a dedupe key, so a doubled call adds nothing and a missed one is picked up by the next.

Each finished visit can send a customer two emails, so Resend's free 100 a day runs out at about 50 visits. Queued emails then wait and retry each hour.

### Uptime alerts

`/api/health` answers 200 when the database is up and background jobs are moving, and 503 when they're stuck: no worker run for 7 minutes (three missed calls in a row), or a job waiting more than 15. Point a free monitor at it, such as UptimeRobot, and have it text or email you. It reports timings only, nothing private.

Settings, System (for `ADMIN_EMAILS`) shows **Scheduled calls**: how many of pg_net's calls into the app failed in about the last 6 hours, and the last error. pg_cron marks a run succeeded as soon as the request is queued, so a call that dies in transit only shows there.

## Runbook (SQL editor, production)

**Is a failed pg_net call a lost run?** A failure that happened after the app got the request is harmless. Compare failures with the worker's own run times:

```sql
select created, status_code, error_msg from net._http_response
where error_msg is not null or status_code >= 400 order by created desc limit 20;
select value from app_setting where key = 'worker.runs';
```

**Change one job without re-running the whole script**, for example the worker's cadence and timeout:

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'flake-jobs'),
  schedule := '*/2 * * * *',
  command := $c$select net.http_get(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url' order by created_at desc limit 1), '/') || '/api/cron/jobs',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' order by created_at desc limit 1)),
    timeout_milliseconds := 15000);$c$
);
```

**Move pg_net out of `public`** (advisor 0014). `pg_net` can't be moved with `alter extension ... set schema`, so it is dropped and created again. The cron jobs are stored as text and keep working; the in-flight request queue and the response log are cleared, so at most one scheduled call is missed. Do it between storms:

```sql
select extnamespace::regnamespace as schema from pg_extension where extname = 'pg_net';  -- public
begin;
drop extension pg_net;
create extension pg_net schema extensions;
commit;
select extnamespace::regnamespace as schema from pg_extension where extname = 'pg_net';  -- extensions
select net.http_get(url := 'https://example.com', timeout_milliseconds := 5000);           -- queues
-- A minute later, a row with status_code 200:
select id, status_code, error_msg from net._http_response order by id desc limit 1;
```

If `create extension` fails, run `create extension pg_net;` to put it back in `public` as it was and nothing else changes.

## Staging (optional)

A second Vercel deployment and Supabase project with `APP_ENV=staging`. Outside production, real SMS and live Stripe keys are hard-blocked even if present, and `PROVIDERS_MODE=mock` is allowed: `/dev/inbox` shows the texts that would have gone out, and a banner says it's a test.

## Local

`pnpm db:start` does not schedule pg_cron. With `APP_ENV=local` (not `staging` or `production`), `apps/web/instrumentation.ts` drains the job table every 2 seconds. See `docs/TESTING.md` for checking it on real phones.

## Before real money

- Move Vercel to Pro (Hobby is non-commercial) and Supabase to Pro for backups and storage.
- Resolve the 216LABS tax ID with Stripe, then run one test-mode charge, one decline and one net-30 invoice. The Stripe code has unit tests against Stripe's signature scheme but has not yet run against Stripe itself.
- Check the toll-free verification field names against Twilio's current docs on the first real submission.
- Have a lawyer read the three legal pages. They are marked as drafts.
- Confirm the OSM and Esri basemap terms.
