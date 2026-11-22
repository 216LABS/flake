# Spike: facility-manager work-order portals (issue 229)

Research only. No code, signups or partner applications without Flip's OK. Written Nov 22, 2026 from public documentation; anything not confirmed there is marked **unconfirmed**.

## Why
Large snow firms get much of their commercial work through national facility managers. Those managers run work orders through **ServiceChannel** or **Corrigo** (JLL), and the contractor has to check in and out of each work order and attach proof. If Flake doesn't sync, the firm types every visit twice.

## ServiceChannel
- **API:** REST with OAuth 2.0 and JSON. Integration pricing is based on annual work-order volume. ([integrate your systems](https://servicechannel.com/tools/integrate-your-systems-with-servicechannel/))
- **Check-in/out:** one pair of universal endpoints for every check-in type: `POST /workorders/{id}/universalCheckIn` and `.../universalCheckOut`. A check-in moves the work order to In Progress / On Site. The check-in returns an ID (`MechanicId`) that the matching check-out has to reuse, with the same user. ([provider check-in/out](https://developer.servicechannel.com/guides/checkin/provider-check-in-out/), [about](https://developer.servicechannel.com/guides/checkin/about-check-in-out))
- **Permission:** ServiceChannel turns on a check-in/out permission per subscriber and provider. Without it, API check-ins still work but **can't set the time**: they're stamped when sent. Flake's offline phones send later, so we need the permission to keep the real times. ([before you start](https://developer.servicechannel.com/guides/checkin/before-you-start))
- **Limits:** no check-in on a completed work order (except Completed / Pending Confirmation). Times must fall between the work order's call date and the location date plus 24 hours.
- **Other ways in:** GPS check-in in ServiceChannel's own app, and phone IVR (dial in, PIN, work order number). ([GPS check-in](https://developer.servicechannel.com/guides/checkin/gps-check-in-out/), [IVR help](https://servicechannel.atlassian.net/wiki/spaces/SCUCP/pages/579764555))
- **Proof and invoices:** attachments and invoice submission exist in the API. The exact schemas weren't in what we read (**unconfirmed**).

## Corrigo (JLL)
- **API:** an enterprise REST API covering work orders, assets, procurement, billing and vendors ([API listing](https://apis.io/apis/jones-lang-lasalle/jones-lang-lasalle-work-orders-api/)). A third-party page says there are two: the Enterprise REST API (developer.corrigo.com) and a CorrigoPro Direct API (**unconfirmed**, secondary source).
- **Access is provisioned, not self-serve:** credentials and integration scope come from JLL.
- **Check-in:** JLL markets GPS check-in/out for providers ([JLL](https://engage.jll.com/corrigo-service-provider)). We found **no** public API endpoint or IVR flow for Corrigo check-in. That's the first question for JLL.

## Mapping a Flake visit to a portal

| Flake | ServiceChannel | Corrigo |
|---|---|---|
| Arrive (device time, GPS) | universalCheckIn with the real time (needs the time permission) | **unknown** |
| Done (device time) | universalCheckOut, same MechanicId | **unknown** |
| Before/after photos | work-order attachments | **unconfirmed** |
| Depth, salt, services | notes on the work order or check-out | **unconfirmed** |
| Approved bill | invoice submission | billing API exists; flow **unconfirmed** |

What's missing on Flake's side: a link from a Flake lot to the portal's location ID and from a storm visit to a work-order number. Portals issue one work order per storm per location, so the office (or a poll) has to match them.

## Effort and recommendation
- **ServiceChannel first.** Its check-in model is documented and it's the larger network for retail and restaurant chains. Estimate: 2 to 3 weeks after access. That covers OAuth, a lot-to-location map, matching work orders to storms, check-in/out from visits with real times, attachments, and a "Needs a look" list like QuickBooks has. Invoices would come after.
- **Corrigo second,** once JLL answers the check-in question.
- **Build only when a pilot customer works through one** and can introduce us to their ServiceChannel contact. Most integrations are approved per subscriber.

## Questions for Flip
1. Is a pilot customer doing NSP work through ServiceChannel or Corrigo today? Which subscribers?
2. ServiceChannel prices integrations by work-order volume. Is any partner fee worth paying before a customer asks? (**Spending is Flip's call.**)
3. OK to contact ServiceChannel and JLL for developer access, named as 216LABS?
