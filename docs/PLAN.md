# Flake — PLAN (v1.0, 2026-11-06)
Flake by 216LABS is snow-plow operations software for 1–25-truck plow companies. It covers weather-triggered storm dispatch, a no-install driver check-in, automatic proof of service, and one-click billing. Software is free, and Flake earns a small cut of payments.

Read with: BUILD_SPEC.md, DECISIONS.md, ADDENDUM_WEATHER.md, ADDENDUM_PAYMENTS.md, ADDENDUM_SMS_COMPLIANCE.md, ADDENDUM_DEVOPS.md. Research behind it: WISHLIST.md, UX_BLUEPRINT.md, competitors.md.

## 1. Problem (evidence in WISHLIST.md / UX_BLUEPRINT.md)
1. Billing after a storm means re-keying clipboards or Sheets into QuickBooks, and it's error-prone ("0% confidence in anything that was billed").
2. Storm dispatch is bolted onto generic tools (Jobber "zones instead of routes"). Operators run storms from group texts, binders and Excel.
3. Field apps crash, force re-logins, lose photos and drain batteries (Service Autopilot, Sitefotos, Yeti reviews).
4. Subcontractors won't install another app ("a text message and an hour sheet accomplishes just as much").
5. Slip-and-fall liability requires per-visit records: time, GPS, photos, salt, and the weather and forecast relied on (SIMA).
6. Property managers want per-visit completion reports. Homeowners hate silence and no-shows.

## 2. Product promise
"Your drivers tap a text link, your customers get proof, and you get paid the night of the storm."

## 3. Personas
- **Owner-operator (primary buyer):** 1–10 trucks, often drives too. Wants on-time service, every push billed, and to survive claims.
- **Dispatcher/office:** calls out the crew, publishes routes, watches open/done stops, moves stops, answers clients.
- **Driver/subcontractor:** next stop and its notes, a fast log, paid on time. Gloves, night, wet screen, weak signal, older phone.
- **Commercial property manager / HOA:** per-visit record within 24 h and a storm contact.
- **Residential customer:** done before work, ETA, easy pay.

## 4. v1 scope
### Must-have (M)
- M1 Multi-tenant org, roles (owner, dispatcher, driver, sub), Supabase Auth (email magic link for office; signed link tokens for drivers).
- M2 Customers and sites: address geocode, NWS grid mapping, site polygon(s), notes and pinned photos (stakes, pile spot, ADA ramp, priority entrance), priority, service window, trigger depth per service.
- M3 Contracts and pricing per site: `per_push`, `per_inch_tier`, `per_event`, `seasonal` (installments), `hourly`; salt priced per bag/lb/ton/application; e-sign acceptance plus card or ACH on file.
- M4 Routes: master routes (ordered stops per truck), reusable every storm.
- M5 Storm event: start manually or from a trigger alert, then snapshot routes into a `storm_run` with assigned drivers; publish, then move stops; close.
- M6 Driver PWA via signed SMS/email link: next-stop card, navigate, Arrive, depth, before/after photos, salt stepper, Done, Problem; offline outbox; Spanish toggle.
- M7 Storm dashboard: per-truck live lists (open / in progress / done / skipped / late), alerts, secondary map, bulk customer texts.
- M8 Automatic customer notices: on the way, done + photo link, running late (SMS once verified, email always).
- M9 One-click billing review: draft invoice lines from visits, flags only, approve, then charge cards / send invoices (Stripe Connect, application fee), QBO CSV export.
- M10 Proof records: immutable visit records plus weather snapshots; per-visit completion report email to commercial clients.

### Differentiators (D)
- D1 Weather trigger alerts per site (NWS forecast + driver depth + alerts) with a drafted storm run. The owner confirms in one tap.
- D2 Auto-measured quotes: parcel + building footprints + OSM parking give an estimated area, the owner draws to confirm, the rate card produces a price, and a quote link is sent with e-sign and card capture.
- D3 Proof packet PDF for any site and date range: contract trigger, forecast and observed snapshots with hashes, every visit with times/GPS/photos/salt, customer messages.
- D4 Billing check: missed pushes (site in storm run with no visit), duplicates (two "done" visits within 60 min with no re-plow flag), visits with no GPS match (>150 m from the site polygon).
- D5 Sub pay statements per storm (Pro).
- D6 Free SEO tools: a snow removal contract builder (PDF) and a snow removal pricing calculator, both of which capture leads into Flake signup (keyword data: contract template 590/mo, contracts 720/mo, commercial pricing calculator 480/mo).

### Later (L, not in v1)
Route optimizer, salt inventory and purchasing, customer self-serve portal, native app with background geofencing (Expo), 10DLC local numbers, QuickBooks Online live sync, receptionist phone line for "when are you coming" calls, lawn/landscape season mode, hauling/relocation, equipment maintenance, payroll.

## 5. Non-goals
- No fully automatic dispatch without an owner tap in v1 (liability).
- No consumer marketplace like Plowz & Mowz.
- No fabricated weather. If data is missing, say "unavailable."
- No fake social proof or testimonials anywhere in the marketing.
- No marketing SMS.

## 6. Pricing (DECISIONS D5)
- Free: up to 25 sites, all core features, 1% application fee on Flake-processed payments (min $0.50, max $25).
- Pro: $79/mo or $790/yr, unlimited sites, sub pay statements, QBO export, 0.5% fee.
- Free first season for early testers through Apr 30, 2027.

## 7. Milestones (build all in one pass; these are for organizing, not for stopping)
1. Foundation: monorepo, DB + RLS, auth, tenants, mocks for all providers, seed demo tenant.
2. Customers/sites/contracts/routes, plus onboarding in under 15 minutes with auto-measure.
3. Weather polling + trigger alerts + archive.
4. Storm runs + driver PWA + storm dashboard + notices.
5. Billing review + Stripe Connect + invoices + QBO export.
6. Proof packet + completion reports + SEO tools + marketing pages.

## 8. Success metrics (for Flip, not for the code)
- 3 operators running a real storm on Flake by Jan 15, 2027.
- Median time from storm close to invoices sent: under 10 min.
- Zero lost driver records (outbox lag p95 < 2 min after signal returns).
- ≥$10k of payments processed through Flake in the first season.

## 9. Open questions for prospects (research couldn't answer these)
1. Would their drivers and subs actually tap an SMS link mid-storm, and are any phones too old for a modern browser?
2. How do they decide trigger depth in practice? Do they trust forecast data or only eyes on the lot?
3. What share of their customers would put a card or ACH on file? Do commercial clients insist on net-30 checks?
4. Would they accept a 1% payment fee instead of a monthly price?
5. Which salt units do they use (bags vs tons vs "loads")?
6. How many use subs, and how do they pay them today?
7. Do any already have a toll-free or business texting number they'd want to keep?
8. What reports do their property managers or insurers actually request?
