# Spike: QuickBooks Desktop, Sage, and truck GPS (issue 230)

Research only. No paid partner accounts without Flip's OK. Never store a customer's telematics token in the repo or logs. Written Nov 22, 2026; anything not confirmed in public documentation is marked **unconfirmed**.

## Accounting beyond QuickBooks Online

**Built today:** QuickBooks Online sync (issue 162) and the QuickBooks Online invoice CSV (per storm, or now per date range from Settings, Data export).

**QuickBooks Desktop**
- Desktop's own CSV/Excel import covers lists, not invoices. Invoices go in as an **IIF** file (File > Utilities > Import > IIF Files), which can carry transactions. ([Intuit IIF help](https://quickbooks.intuit.com/learn-support/en-us/help-articles/export-or-import-intuit-interchange-format-iif-files/00/262337), [community](https://quickbooks.intuit.com/community/other-questions-72/how-to-import-invoice-transactions-into-quickbooks-desktop-145238))
- A separately installed "Import Excel and CSV" toolkit is mentioned for CSV; whether it does invoices is **unconfirmed**.
- Intuit doesn't support IIF imports, and a bad file can damage a company file. Some vendors say batches are capped (around 100 invoices, **unconfirmed**).
- The Web Connector, a Windows app that syncs through SOAP, is the "real" integration path. It's heavier: it needs a service we host and a qbXML integration (**not researched in depth**).

**Sage (100 Contractor / Intacct)**
- No public import layout for AR invoices was found for Sage 100 Contractor. Sage Intacct has an API and CSV imports (**unconfirmed for AR invoices**).

**Recommendation:** start with **file exports**: an IIF export for QuickBooks Desktop, built like the QuickBooks Online CSV (customer, date, item, amount, memo). Estimate: 3 to 5 days, including testing in a real Desktop file, which needs a license (**Flip's call**). Do Sage only when a pilot runs it, starting from a real sample file they send us.

## Truck GPS / telematics

Goal: read a company's truck breadcrumbs so a truck's arrival and departure become **supporting evidence** on a visit and in the proof packet. It would also cover a driver whose phone has location off.

| Provider | API access | Auth | Breadcrumbs |
|---|---|---|---|
| **Samsara** | Customers make their own API token in the dashboard (Settings, API Tokens), with scopes and tag access. ([auth](https://developers.samsara.com/docs/authentication)) | Bearer token | `GET /fleet/vehicles/locations/history` with `startTime`/`endTime`, filtered by vehicle or tag. Samsara now points to `/fleet/vehicles/stats/history` for GPS plus diagnostics. ([history](https://developers.samsara.com/reference/getvehiclelocationshistory)) |
| **Geotab** | MyGeotab SDK, called as a MyGeotab user (username, password, database). ([GetFeed](https://developers.geotab.com/myGeotab/apiReference/methods/GetFeed/)) | Session from credentials | `GetFeed` of `LogRecord` (GPS points), kept in step with a per-type token. Not in time order, so de-duplicate and sort. Users without company-group access can hit 180 s timeouts. ([data feed](https://developers.geotab.com/myGeotab/guides/dataFeed)) |
| **Verizon Connect Reveal** | Developer portal with self-registration; two sets of credentials. ([quick start](https://fim.us.fleetmatics.com/content/home/support/guides/DeveloperQuickStartGuide.htm)) | Base64 REST credentials exchanged for a ~20-minute bearer token | Vehicle GPS History API, polled per vehicle number for a period. History depends on the account's data plan. ([GPS history](https://fim.us.fleetmatics.com/api/96d671c7-445d-40ad-8223-795cac7d7ac9.fleetmatics-p-us)) |
| GPS Insight | Not researched. | | |

**Prototype design (no code yet)**
1. Settings, Integrations: the customer pastes a read-only token (Samsara) or service-user credentials (Geotab or Verizon). Stored encrypted like the QuickBooks tokens, never logged.
2. Map each provider vehicle to a Flake **truck** (the equipment log, issue 161). Storm runs already record which truck ran a route.
3. After a storm closes, pull each truck's breadcrumbs for the storm window in one request per truck. Keep them like weather snapshots: archived raw, with a hash.
4. **Geofence matching:** for each visit on a run with a truck, find the truck's points inside the lot's polygon (or within ~60 m of its pin). The first point is "truck arrived", the last "truck left". Show both next to the phone's times; flag when they disagree by more than about 10 minutes.
5. Proof packets add a "Truck GPS" line per visit with the provider, points used and the archive hash. Phone GPS stays the primary record.

**Effort:** Samsara 1 to 1.5 weeks (token-based, simplest). Geotab about 1.5 weeks (feed tokens, ordering). Verizon about 1.5 weeks (token refresh, per-vehicle polling). The geofence matching and proof-packet work is shared, about 1 week once.

**Recommendation:** Samsara first, when a pilot customer has it. A customer can make its own token, so there's no partner agreement or cost to us.

## Questions for Flip
1. Do any pilot customers run QuickBooks Desktop or Sage, or Samsara, Geotab or Verizon Connect?
2. OK to buy a QuickBooks Desktop license to test an IIF export? (**Spending is Flip's call.**)
