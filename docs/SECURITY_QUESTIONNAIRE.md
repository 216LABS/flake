# Security questionnaire answer bank (issue 231)

Answers for vendor security questionnaires from larger plow companies and the property managers behind them. **Every answer must match what is built and running.** When something isn't done, say so; never round up. Update this file when anything here changes. Last reviewed Nov 22, 2026.

## Company
- **Vendor:** 216LABS LLC, Ohio. Product: Flake (snow plow operations: routes, driver links, proof, billing).
- **Contact for security:** sam@216labs.dev.
- **Certifications:** none. No SOC 2 or ISO 27001. See "Later" below.

## Hosting and infrastructure
- **App:** Vercel (serverless functions and static assets). Production deploys from the `main` branch.
- **Database and files:** Supabase (managed PostgreSQL and object storage), US region.
- **We run no servers of our own.**

## Encryption
- **In transit:** HTTPS (TLS) for every page and API, including driver links and webhooks.
- **At rest:** the database host encrypts at rest.
- **Secrets in the data:** driver route links and customer quote links are stored as a one-way hash, plus an encrypted copy (AES-GCM, key held in the host environment) so the office can show them again. QuickBooks tokens are stored encrypted.
- **Application secrets** (API keys) live in the hosting provider's environment settings, never in the code repository. Commits are scanned for leaked secrets with gitleaks before they are pushed (a manual step, not yet in CI).

## Tenant isolation
- Every company's rows carry its tenant ID, and PostgreSQL **row-level security** policies restrict every read and write to the signed-in user's company. Isolation is enforced by the database, not only by the app.
- An automated RLS test suite (`pnpm test:db`) runs in CI and checks cross-company reads and writes are refused.

## Access control
- **Office users:** passwordless sign-in by a one-time code emailed to the user (Supabase Auth). Roles: owner, dispatcher, view-only.
- **Drivers:** a per-run link that works for one storm, can be revoked by the office, and gives access only to that run's stops. No prices, customer contacts or other runs.
- **Customers:** a private records-page link per customer, which the office can reset. Quotes have their own link.
- **Platform admins:** a fixed allow-list (`ADMIN_EMAILS`) for a few cross-company tools. Nothing else.
- **SSO:** not offered yet (Google Workspace and Microsoft Entra later, when a customer needs it).

## Backups and recovery
- **Daily database backups: not enabled yet.** Daily backups need the database host's paid plan (Supabase Pro), which is on the launch list and not yet turned on. A backup and restore test is planned once it is.
- **Customer-side copy:** an owner can export all company data at any time (CSV per table, or a zip), from Settings, Data export.

## Logging and monitoring
- **Errors:** Sentry (error reports from the app).
- **Uptime:** an outside check every 15 minutes (GitHub Actions against `/api/health`). Two failures a minute apart open an "outage" issue; a passing check closes it. History is public at `/status`.
- **Audit trail:** visits are append-only. Office corrections are stored beside the original with who, when and why. Messages sent are logged per company.

## Incident response
- A small team (the founder). Outage alerts reach the team by GitHub notification; customers see status at `/status`.
- **Not in place yet:** a written incident response plan, an on-call rotation, and a promised response time. We don't promise one.

## Data retention and deletion
- Visits, photos and weather records: 7 years by default (claims can arrive late). Records under an open dispute aren't deleted. See `/legal/data-retention` and `/legal/privacy`.
- Export any time; deletion on request, case by case (see the retention page).

## Subprocessors
- Vercel (hosting), Supabase (database, files, sign-in), Twilio (texts, once a company's texting is verified), Stripe (payments, if connected), Sentry (errors), Intuit (QuickBooks, if connected), Resend (email, only where email is still used).
- Address and map lookups: US Census geocoder, Mapbox, OpenStreetMap services (Photon, Overpass, tiles), Esri imagery tiles.
- Public weather data: NOAA / National Weather Service, NOHRSC, Iowa Environmental Mesonet (airport observations).

## Vulnerability management
- Dependencies are pinned in `pnpm-lock.yaml`, and new packages need explicit approval. **Automated dependency update alerts (Dependabot) are not set up yet** for this repo.
- Report vulnerabilities to sam@216labs.dev. No bug bounty.

## Later (known gaps, for honesty)
- SOC 2 (no tooling bought; Flip's call), daily backups and restore tests, written incident response plan, SSO, penetration test, a data processing agreement template.
