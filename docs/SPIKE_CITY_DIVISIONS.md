# Spike: city and village plow divisions (issue 238)

Research and design only. No public map or 311 integration until a city agrees to a pilot, and no messages to real residents in testing. Written Nov 22, 2026.

## What cities need, against what Flake has

| Need | Flake today | Gap |
|---|---|---|
| Salt and cost report for council: salt per storm, per route and per season against the ODOT allocation; cost per storm; overtime | Salt per visit and per storm, yards with deliveries and counts (issue 169), crew hours and payroll with overtime (issue 170), equipment and fuel (issue 161) | One printable "storm report" per storm and season, in a city's terms (lane miles, routes by priority, allocation used) |
| Priority levels: mains, hills, bridges and schools first, then residential | Lot priority 1 to 5, "Do this one first", routes in order | Priority is per lot, not per **street segment**, and there's no "level 1 done" roll-up |
| Resident status: "where are we" by priority and area, or a public map of streets done | Customer records pages (per customer); storm board (office only) | A **public**, no-login status page per city: each area and priority level marked done, in progress or not started |
| Resident complaints: "my street wasn't plowed", checked against GPS | Customers can ask for a visit from their records page (issue 191) | A public form keyed by street; a match against visits and positions near that street; one-tap answer |

## How a "city" company would map onto Flake
- **Company kind = municipal.** No customers, quotes, contracts or bills: billing screens hidden, the setup checklist changed.
- **Streets or segments instead of lots.** A "lot" is a street segment (or a group of short streets) with a line instead of a polygon. Routes stay routes; priority sets the order. Lots are polygons today, so a segment type is the main model change.
- **Drivers are city employees.** The driver link works as is. Most cities already have AVL (Samsara, Geotab and others, see `SPIKE_ACCOUNTING_TELEMATICS.md`), so truck GPS would mark segments done better than phone taps. Phone taps per segment would be too many at 3 AM.
- **No customer messages.** Resident communication is a public page, not texts.

## Recommended minimal pilot (no new hardware)
1. **Council salt and cost report:** per storm and per season, salt used against the allocation (entered by the city), salt cost, overtime hours, routes completed. Mostly existing data. Estimate: about 1 week.
2. **Public priority status page:** per area and priority level (Mains, Secondary, Residential), whether it's done, in progress, or not started, updated from the storm board. No map, no street detail, no personal data. Estimate: about 1 week.
3. **Later, only with a pilot city:** segments as lots, AVL import, and the complaint form.

## What a city needs to buy
- A W-9, a written quote, and terms (the existing Terms, plus municipal-friendly payment by check or invoice, Net 30).
- **Bid thresholds:** many Ohio entities follow the amount in ORC 9.17, which went up 3% a year from 2023. The Department of Commerce set it at **$77,250 for 2025** ([Ohio Township Association](https://www.ohiotownships.org/news/competitive-bidding-thresholds-increased-for-2025)). For cities, ORC 735.05 now points to that figure instead of a fixed $50,000 ([Bricker](https://www.bricker.com/insights/publications/ohio-department-of-commerce-publishes-increased-bidding-threshold-for-numerous-public-entities-for-2025), [ORC 735.05](https://codes.ohio.gov/assets/laws/revised-code/authenticated/7/735/735.05/9-30-2025/735.05-9-30-2025.pdf)). The 2026 figure wasn't published in what we found; a 3% rise would make it about $79,568, which is **our arithmetic, unconfirmed**. Townships follow their own statutes and policies (one 2026 township policy sets $25,000). A first-year Flake subscription would be far below any of these, so a direct purchase on a quote should work. Confirm with each city's finance office.
- Insurance certificate and data terms, which the trust pack covers (issue 231).

## Questions for Flip
1. Which city or village is closest to a pilot, and who is the contact (streets superintendent or service director)?
2. Will they enter their ODOT salt allocation, or should Flake read it from their purchase orders?
3. OK to show a public status page under the city's name (needs their written OK)?
