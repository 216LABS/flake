# Deploying Flake

Two ways to run it. Start with the free test deployment. Never run `pnpm seed:demo` against anything real people use.

## Free test deployment

Costs nothing and uses no paid accounts. Real weather, parcels, sign-in and phones; mock Stripe and SMS. `/dev/inbox` shows the texts that would have gone out, and a banner says it's a test.

| Piece | Service | Free plan limit that matters |
|---|---|---|
| App | Vercel Hobby | Non-commercial use only. About 4 hours of active CPU a month |
| Database, sign-in, photos | Supabase Free | 500 MB database, **1 GB of files**, pauses after a week with no activity |
| Background jobs | Supabase `pg_cron` | Free |
| Weather, parcels, geocoding | NWS, NOHRSC, Census, county GIS | Free |
| Email (optional) | Resend Free | 100 a day, needs a verified domain. Off until a key is set |

**What 1 GB means:** photos are kept at original size, about 3 MB each, so 1 GB holds roughly 150 visits with before and after photos. Settings, System shows the usage, and the dashboard warns at 80%. When storage fills, photos wait safely on the driver's phone, but they won't upload until there's room.

**Sign-in email:** Supabase's built-in sender allows only a few emails an hour. That's fine for one or two testers. Add Resend as custom SMTP in Supabase for more.

### Steps
1. **Supabase.** Create a project, then from `packages/db`:
   ```sh
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```
   In Auth, URL Configuration, set Site URL to the app URL and add `<app url>/**` to the redirect URLs.

2. **Vercel.** From `apps/web`:
   ```sh
   vercel login
   vercel link
   ```
   Set Root Directory to `apps/web`. Use the `.vercel.app` URL, or add `flake.216labs.dev` if the domain lets you.

3. **Environment variables.**

   | Name | Value |
   |---|---|
   | `APP_ENV`, `NEXT_PUBLIC_APP_ENV` | `staging` |
   | `PROVIDERS_MODE`, `NEXT_PUBLIC_PROVIDERS_MODE` | `live` |
   | `APP_BASE_URL` | the app URL |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
   | `DATABASE_URL` | the Transaction pooler URL, port 6543 |
   | `DB_POOL_MAX` | `3` |
   | `CRON_SECRET`, `LINK_TOKEN_SECRET` | `openssl rand -hex 32`, one each |
   | `NWS_USER_AGENT` | `(flake.216labs.dev, sam@216labs.dev)` |

4. **Deploy:** `vercel deploy --prod`

5. **Turn on background jobs,** with those same values in your shell:
   ```sh
   pnpm cron:install
   ```
   Jobs then run every 2 minutes. Without this nothing in the background happens: no links, charges, weather or PDFs.

6. **Try it.** Sign in, create your company, add a customer and a route, start a storm, and open the route link on a real phone. Crew links show on the storm board as a QR code and copy-link.

## Real production

The same steps, with these changes:
- **Plans:** Vercel Pro, because Hobby's terms don't allow commercial use, and Supabase Pro for backups and storage.
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
- **Jobs:** `CRON_JOBS_EVERY_MINUTES=1 pnpm cron:install`.

`LINK_TOKEN_SECRET` must never change after launch. It hashes every driver and quote link, so changing it kills them all. `NEXT_PUBLIC_*` values are built into the page, so redeploy after changing them.

### Before real money
- Resolve the 216LABS tax ID with Stripe, then run one test-mode charge, one decline and one net-30 invoice. None of the Stripe code has run against Stripe yet.
- Get Flake's Twilio Primary Customer Profile approved, then check the toll-free field names against Twilio's current docs.
- Have a lawyer read the three legal pages. They are marked as drafts.
- Confirm the OSM and Esri basemap terms.
