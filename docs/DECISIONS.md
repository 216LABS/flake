# Flake — DECISIONS (v1.0, 2026-11-06)

These are locked decisions for the v1 build, made on Flip's instruction ("you make all the calls"). Each one has a rationale and sources. Tags: **[V]** a verified fact from a cited source; **[J]** a judgment call; **[T]** check against the provider's current docs during integration.

## D0. Existing code: start fresh in `216LABS/flake`
- GitHub has `216LABS/flake`: private, **empty** (size 0, created 2026-10-22, one push, no language). Code search of 216LABS and Lake-Effect-Labs for "plow" and "snow plow" returned nothing. There is no Flake code on the box. Only `insight/FIVE.md` mentions "the weather and AI from Flake" as an idea. **[V]**
- **Decision:** build fresh in the existing empty repo `216LABS/flake`. There's nothing to reuse. **[J]**

## D1. Name, brand, URL
- Name: **Flake by 216LABS**. Marketing path for now: `216labs.dev/flake`; the app runs on `flake.216labs.dev` (a Vercel subdomain). Buy a standalone domain later, once 3+ paying tenants make it worth it. **[J]**

## D2. Stack (matches Flip's Clipppy handoff)
- TypeScript strict, Next.js App Router, pnpm + Turborepo, Tailwind + shadcn/ui, Supabase (Postgres, Auth, Storage, RLS multi-tenant), Drizzle for types and migrations, Vercel (web + Cron), Stripe Connect, Twilio. There's no Python because Flake has no ML or media workers. **[J]**
- Background work uses a Postgres jobs table (`FOR UPDATE SKIP LOCKED`), drained by Vercel Cron hitting `/api/cron/*` every minute. Vercel Cron's per-minute schedule works on Pro plans **[T]**; Supabase pg_cron + `pg_net` is the fallback. **[J]**
- PDFs: `@react-pdf/renderer` on the server, no headless Chrome, so it runs fine on Vercel functions. **[J]**
- Maps: MapLibre GL + OSM raster or vector tiles for the dashboard. Satellite imagery for drawing lot polygons uses a Mapbox Satellite **or** Esri World Imagery basemap, behind a `TileProvider` interface with a mock. **[J][T: confirm the free-tier ToS of the chosen basemap before launch]**

## D3. Weather: NWS gridpoints for forecasts, NOHRSC for observed, archive everything
- **Forecast:** api.weather.gov. `/points/{lat},{lon}` → `forecastGridData` → the `snowfallAmount` layer (an ISO-8601 interval time series, layer-level `uom`, usually mm) on a ~2.5 km grid. It's free open data and requires a descriptive `User-Agent` with contact info. The rate limit isn't published; retry after about 5 s. Supports `Last-Modified`/`If-Modified-Since` → 304. The grid mapping can change, so refresh `/points` periodically. **[V]** Sources: https://weather-gov.github.io/api/gridpoints, https://www.weather.gov/documentation/services-web-API, https://github.com/weather-gov/api/discussions/872
- **Alerts:** `api.weather.gov/alerts/active?point=lat,lon` (Winter Storm Warning, Lake Effect Snow Warning, etc.). **[V/T]**
- **Observed:** the NOHRSC National Gridded Snowfall Analysis. It has 6, 24, 48 and 72 h accumulations, is issued every 12 h, gets reprocessed for 5 days, and is available as GRIB2/NetCDF/GeoTIFF. It's the only CONUS-wide gridded snowfall product that blends in observations. **[V]** Sources: https://www.nohrsc.noaa.gov/snowfall/, https://www.nohrsc.noaa.gov/technology/pdf/PDD_National_Gridded_Snowfall_Analysis.pdf. Because it only comes out every 12 h, it's used for the **evidence record and billing reconciliation**, not live dispatch.
- **Near-real-time "has it hit trigger":** add up NWS forecast `snowfallAmount` for the elapsed intervals since storm start, and combine it with **driver-reported depth at the first site** (a one-tap depth picker in the driver app), plus optional NWS station observations (`/stations/{id}/observations`) for temperature and conditions. A trigger alert fires when forecast-elapsed OR driver-reported depth ≥ the site's trigger. The owner always confirms before dispatch, so there's never fully automatic dispatch in v1. **[J]** Rationale: there's no free, real-time, observed per-site snowfall feed. MRMS gives precip rate, not depth, and needs GRIB decoding, so it's deferred. Plow operators already verify depth themselves before rolling (r/Snowplow and PlowSite trigger threads).
- **Rejected for v1:** the Open-Meteo free tier (non-commercial only, and commercial plans are paid; https://open-meteo.com/en/pricing). Tomorrow.io and Visual Crossing are paid and unnecessary for one metro. They can be added as an optional second source behind the `WeatherProvider` interface. **[V/J]**
- **Evidence archive:** every poll stores the raw JSON response (gzip) in Supabase Storage `weather-archive/{office}/{gridX},{gridY}/{fetched_at}.json.gz`, with a sha256 hash, `Last-Modified`, the request URL, and a `weather_snapshot` row. The proof packet cites the snapshot ids and hashes. This follows SIMA's advice to keep the forecasts you relied on. **[J]**
- **Polling:** each site is mapped to its NWS grid cell, and sites are deduped per cell (Cleveland metro ≈ tens of cells). Poll every 60 min normally, and every 15 min when an alert is active or forecast snowfall in the next 24 h exceeds 0. Always send conditional requests. **[J]**

## D4. Lot sizing for automatic quotes: parcel + footprint estimate, then the owner draws to confirm
- **Parcels (open data):** Cuyahoga (ArcGIS REST `CCFO/Current_Year_Appraisal_Parcels/MapServer`), Summit (FeatureServer `Summit_County_Parcels_for_EAM`, GeoJSON, max 2,000 records/query), Lorain (Auditor open-data hub, GeoJSON/API), Lake (GIS Hub open-data downloads), Medina (Auditor open-data "Medina Parcel Layer v2"). **[V]** Geauga: availability not verified **[T]**.
- **Buildings:** Overture Maps Buildings, which includes Microsoft US footprints (ODbL). **[V]** https://docs.overturemaps.org/attribution/
- **Paved hint:** OSM `amenity=parking` polygons (ODbL). **[V]**
- **Algorithm:** estimated plowable area = OSM parking polygons inside the parcel if any exist, otherwise (parcel area − building footprints) × a land-use paved ratio (residential driveway default 0.12, commercial default 0.55; owner-tunable). The result is shown as an **estimate** with a satellite map, and the owner draws or edits the polygon(s) to confirm. The confirmed polygon area is what's used for pricing. **[J]** Rationale: a parcel alone over-counts lawns, and an ML paved-area model is out of scope for v1. Drawing takes under a minute and also creates the site map that drivers see.
- **Implementation:** one `ParcelProvider` per county behind an interface, queried live by point (no bulk download in v1), with a 30-day cache. Attribution is shown wherever ODbL data is displayed.

## D5. Payments: Stripe Connect, direct charges, a 1% application fee
- **Account type:** Connect accounts where **the connected account pays Stripe fees and Stripe owns loss liability**, with the Stripe-hosted dashboard. This matches "Standard"/`type=standard` behavior. Under the "Stripe handles pricing" model there's no $2/active-account fee and no 0.25% + 25¢ payout fee. Those fees only apply when the platform handles pricing, as with Express/Custom. **[V]** https://stripe.com/connect/pricing, https://docs.stripe.com/connect/direct-charges-fee-payer-behavior
- **Charges:** **direct charges** on the connected account, with `application_fee_amount` = Flake's fee only (Stripe deducts its own processing fee separately). **[V]**
- **Card on file:** collect a PaymentMethod via a SetupIntent at contract signing (`usage=off_session`). After a storm closes and the owner approves billing, create off-session PaymentIntents. 3DS/declines → send a hosted pay link. **[J]**
- **Net-30 commercial:** Stripe Invoicing on the connected account (`collection_method=send_invoice`, `days_until_due=30`) with `application_fee_amount`. Invoicing adds **0.4% per paid invoice** (Starter). **[V]** https://stripe.com/invoicing/pricing, https://docs.stripe.com/connect/invoices
- **Fees the plow company pays to Stripe:** card 2.9% + 30¢; ACH Direct Debit 0.8% capped at $5. **[V]** https://stripe.com/pricing. Flake shows ACH as the default for commercial invoices, since it's cheaper for large invoices.
- **Flake pricing [J]**, compared against competitors.md (Yeti $66.50–95/mo, Plowdesk free / $95, Icey free to 10 sites, Jobber $29–49+, Service Autopilot $49+, LMN $297):
  - **Free:** up to 25 sites, every core feature, **1.0% application fee** on payments run through Flake (min $0.50, max $25 per payment).
  - **Pro: $79/mo** (or $790/yr): unlimited sites, subcontractor pay statements, QuickBooks Online export, custom SMS sender, and an application fee of **0.5%**.
  - **Free first season** for early testers through April 30, 2027: no Pro charge, and the application fee is still 1% (that's the business model). Owners can turn off online payments entirely and use Flake free with up to 25 sites.
  - Rationale: priced under Yeti and Plowdesk paid tiers, matching the "free + payments cut" model Flip wants. A 1% fee on a $3,000 storm-billing night is $30.

## D6. SMS: Twilio, one toll-free number per tenant, verified in that tenant's name
- Flake is an **ISV**. Twilio requires each customer to have its own subaccount, Secondary Customer Profile and registration in the customer's name, not the ISV's. **[V]** https://www.twilio.com/en-us/blog/developers/best-practices/direct-customer-to-isv-rearchitecture-guide
- A2P 10DLC costs: brand $4.50 (Standard brand with vetting $46), campaign vetting $15, Standard campaign $10/mo, a typical 7 business days, and rejections are common. **[V]** https://help.twilio.com/articles/1260803965530
- Toll-free verification: 3–5 business days. Since Feb 17, 2026 it needs a business registration number (except sole proprietors), and it doesn't carry over between subaccounts. **[V]** https://www.twilio.com/en-us/changelog/business-registration-numbers-required-for-toll-free-messaging-p
- **Decision:** v1 uses a **Twilio subaccount per tenant + one toll-free number, verified with the tenant's EIN and business details**, submitted during onboarding through the API. That's faster, with no TCR brand or campaign monthly fees. While verification is pending, Flake sends driver links by **email and on-screen QR / copy-link**, and customer notices by email. SMS turns on automatically once Twilio reports `TWILIO_APPROVED`. 10DLC is a later upgrade for local-number branding. **[J]**
- Message classes: (a) crew messages (route links, call-outs) to employees and subs who opted in at invite time; (b) transactional customer notices (on the way, done + photo, invoice) for customers who opted in on the contract or quote page. No marketing SMS in v1. STOP/HELP handled through Twilio Advanced Opt-Out, mirrored in the `sms_consent` table. **[J]**
- Alternatives considered: Telnyx and Plivo have similar ISV registration burdens, and Flip's 216LABS already works with Twilio. **[J]**

## D7. Driver app: a no-install PWA with an offline queue; native app later
- iOS home-screen and Safari web apps **don't support Background Sync, Periodic Sync, Background Fetch, or background geolocation**. Geolocation works only in the foreground. IndexedDB works but can be evicted under storage pressure. Installed home-screen apps aren't subject to the 7-day ITP cap. **[V]** https://progressivewebapps.com/background/, https://webkit.org/blog/14403/updates-to-storage-policy/
- **Decision:**
  - Every action (arrive, photo, salt, depth, done, problem) is written first to an IndexedDB outbox with a client UUID and device timestamp.
  - It's flushed on `online`, `visibilitychange` and app open, and every 15 s while the page is open.
  - The server is idempotent on client UUID.
  - The UI shows saved / sending / synced status per stop.
  - Photos are captured with `<input type="file" accept="image/*" capture="environment">`, keeping the **original** file (no client-side compression below 2560 px on the long edge, JPEG q≥0.85), and stored in the outbox as a Blob.
  - "Arrive" is one big button that captures foreground GPS. **Geofence auto-arrive happens only while the page is open** (`watchPosition` while a route is active). True background geofencing needs the native app, which is planned for v2 (Expo).
  - `navigator.storage.persist()` is requested.
  - The server records `device_time`, `received_time` and GPS accuracy. Edits after the fact are append-only corrections. **[J]**

## D8. Timeline
- The NWS Cleveland climatology average date for the first measurable snow (≥0.1") is **Nov 10**. **[V]** https://www.weather.gov/cle/CLE_SnowClimo. Real plowing storms usually come in December. **[J]**
- **Build target:** a usable v1 for 1–3 Lakewood/west-side test operators by **Dec 1, 2026**, with the free season running through Apr 30, 2027. **[J]**

## D9. Things deliberately NOT decided by research (only real plow customers can answer)
See PLAN.md §9 "Open questions for prospects."

## D10. Billing and quoting calls made Nov 13, 2026 (issues 101, 112)
Made by the engineering agent at Sam's request ("make all the decisions"). Each is easy to change if a pilot says otherwise. **[J]**
- **One quote per customer and season.** A lot quoted while another of the customer's quotes for that season is waiting joins its link. One signature accepts every lot; each lot still gets its own contract and signed PDF.
- **A re-sign mid-season** bills what is left of the new total over the installments left, so the season adds up to the price signed. A re-sign below what was already billed bills nothing more.
- **A lot with no contract for the storm's season** is priced from last season's contract, with an info note on the draft. A seasonal lot with no contract this season needs a decision (new quote, or waive to plow it free).
- **Payments not connected:** approved bills wait with what to do next, seasonal installments are recorded monthly as "Bill it yourself", and the office records checks and cash with Mark paid. The customer's records page shows those bills as due with "pay by check or phone".
- **New quotes from April to June** default to next winter's season. Seasons are written like 2026-27.
- **The installment job runs daily** (it bills at most one installment per lot per local month), so the first installment goes out the day after signing.
