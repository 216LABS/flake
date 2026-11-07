# Flake — what plow companies want + UX blueprint
Page: https://cursor.com/canvas/store-51480d5e-7587-4a47-af93-cbca780f3d2f/72dc6e1f-588e-4acd-a89b-6ab095c1d968
Researched Nov 6, 2026. Builds on WISHLIST.md. Competitor-written sources are labeled.

## Five biggest findings
1. **The field app is where every competitor loses.** Service Autopilot, Sitefotos and Yeti reviews describe crashes, re-logins, lost photos, battery drain and broken sync.
2. **Drivers and subs don't want another app.** Yeti requires an install, a company code, email verification and admin approval. A no-install SMS link is Flake's clearest UX edge.
3. **Property managers buy proof.** They want a per-visit record (trigger, arrival and departure, GPS, photos, salt) within 24 hours.
4. **The dispatcher needs a live list, not a map.** Operators run storms from Excel, binders and group texts. The rule is publish once, then move stops; never rebuild the list.
5. **Homeowners' #1 complaint is silence.** Automatic "on the way" and "done + photo" texts fix it.

## Key quotes
- Dispatcher setup: "We now have a dispatch person who takes calls upon arrival, departure, and logs what was done directlt into excel" (https://www.plowsite.com/threads/anyone-know-of-a-snowplow-program-to-show-progress-during-a-push.94325/)
- John Allin: "you need a strong Dispatcher who won't panic when it's snowing hard, or when customers are calling" (https://www.plowsite.com/threads/master-binder.478/)
- Service Autopilot: "It doesn't upload jobs and clock in/clock out times to the office. Crashes constantly" (https://apps.apple.com/us/app/service-autopilot/id789828673?platform=watch&see-all=reviews)
- Sitefotos: "This App will shutdown for no apparent reason and you lose all the data and photos you entered" (https://apps.apple.com/us/app/sitefotos/id1090790390?platform=iphone&see-all=reviews)
- Yeti sub: "Honestly just a text message and an hour sheet accomplishes just as much" (https://www.appbrain.com/app/yeti-software/com.yetisnow.yeti)
- Homeowner: "They never show up, have to call them every time it snows." (https://www.reddit.com/r/regina/comments/10jm4pf/snow_removal_company/)
- Subcontractors unpaid by Plowz & Mowz (https://www.reddit.com/r/lawnmowers/comments/1f37nn4/plowz_and_mowz/, https://www.plowsite.com/threads/avoid-plowz-and-mowz.186827/)

## Personas
| Persona | Jobs to be done | Hates |
|---|---|---|
| Owner (1–10 trucks) | Win contracts, roll on time, bill every push, survive claims | Re-keying into QuickBooks, price creep, apps the crew won't use |
| Dispatcher | Call-out, publish routes, see open/done, move stops, answer calls | Roll calls, "new list 2" in the group text |
| Driver / sub | Next stop and notes, fast log, paid on time | Crashes, re-logins, battery, wet screens, net-30 pay |
| Commercial property manager / HOA | Open before hours, per-visit record, storm contact | Monthly invoice with no event log |
| Residential customer | Done before work, know the ETA, easy pay | No-shows, calling every storm |

## Storm-night journey
| Stage | Pain | Flake's answer |
|---|---|---|
| Pre-season | Pricing in spreadsheets; site notes in drivers' heads | Onboarding in under 15 min: auto-measure, pricing template, pinned notes, e-sign |
| Pre-storm | Silent group texts; forecast not saved | Trigger alerts per site, one-tap call-out with yes/no, forecast snapshot |
| During | Roll calls, rebuilt lists, crashing apps, no signal | Live storm board, SMS-link offline check-in, reassign stops |
| Post | "Undocumented visit is unbillable"; slow billing; disputes | Billing from flags only, proof photo per invoice line, card charge |
| Off-season | Records scattered; claims arrive 6–24 months later | Proof packet PDF, kept 7+ years |
(Stage tasks: Icey storm checklist [competitor] https://iceysoftware.com/tools/storm-checklist; MowProHQ [vendor] https://www.mowprohq.com/blog/snow-dispatch-group-text-vs-board)

## Ranked wishlist
- **Must-have:**
  - Offline-safe check-in.
  - No-install SMS link for drivers and subs.
  - Visit record with time, GPS, full-quality photos and salt.
  - Live storm board.
  - Billing from logs (per push, per inch, per event, seasonal) with card on file.
  - Automatic customer texts.
- **Differentiators:**
  - Snowfall-triggered dispatch drafts with the forecast archived.
  - Auto-measured quotes.
  - One-click proof packet.
  - Billing check: missed and duplicate pushes.
  - Same-day sub pay statements.
- **Later:**
  - Route optimizer, salt inventory, customer portal.
  - Multi-language driver UI, voice notes.
  - Receptionist line for "when are you coming" calls.

## UX principles
1. Glove-first: tap targets of at least 60 px, bottom full-width actions, no swipes, long-press or pinch.
2. Never lose a record: save locally first, show a saved/sending/synced badge, survive calls, rotation and app switching.
3. No install, no login for drivers: a signed SMS link.
4. Three taps per stop; time and GPS come from the device and can't be typed in.
5. Night and wet mode: dark, high contrast, haptic confirmation, no text fields.
6. Battery-light GPS: only during active stops.
7. Publish, then move: never rebuild the list.
8. Proof by default, the same on every visit.
9. Plain words and icons; selectable language (Spanish first).

## v1 flows
- **Driver SMS link:**
  1. A text opens the route.
  2. The next-stop card shows notes and photo.
  3. Arrive, either a tap or the geofence.
  4. Before and after photos.
  5. Salt stepper, then Done, and the next stop loads.
  6. A Problem button with a voice note.
- **Storm dashboard:**
  - A header with snowfall vs triggers and done/open/late counts.
  - Per-truck lists with drag to reassign.
  - A secondary map.
  - Alerts.
  - Bulk customer texts.
- **Billing review:**
  1. Closing a storm drafts priced lines.
  2. Review only the flagged lines.
  3. Approve, which charges cards and sends pay links, plus a QuickBooks Online export.
- **Proof packet:** pick a site and dates to get a PDF with the contract trigger, forecast and observed snow, visits, photos, salt and messages. It can be shared as a link, and commercial clients get an auto per-visit report.
- **Onboarding a customer in under 15 minutes:**
  1. Address to auto-measure.
  2. Pricing.
  3. Pinned notes.
  4. Quote, e-sign and card, then the site goes on a route.

## Competitor teardown
| Tool | Price | Driver setup | Dispatch | Complaints |
|---|---|---|---|---|
| Yeti | $66.50/mo annual, $95 monthly | Install, company code, email verify, approval | Dispatch Routes (18h), shift→route→site→slide to end, crew lead | Battery, photo compression, wrong clock-ins, cost |
| Jobber | $29/mo annual, $49 monthly | General setup, tags | Bulk visits by tag, zones | Snow routing, mass dispatch, add-ons |
| Service Autopilot | $49/mo + sign-up fee | Heavy setup | Snow Dispatch Board | Crashes, re-logins, billing errors, price hikes |
| Plowdesk | Free / $95/mo | Shared routes in app | Storm route templates, offline | Few independent reviews |
| Icey (competitor-written) | Free to 10 sites / from $119 CAD | Storm board | Kanban board | Few independent reviews |
| Sitefotos | Quote only | Forms app | Photo and time logs | Crashes, lost photos |

## Prospect call questions
1. Walk me through your last storm, from the forecast to the last invoice.
2. How do drivers and subs log visits today? What do they refuse to use?
3. What do commercial clients ask you to prove, and how fast?
4. Any slip-and-fall claim or disputed push? What did you have to produce?
5. How do you decide when to roll, and who makes the call?
6. How long does billing take, and how do customers pay?
7. Would drivers and subs tap a text link instead of installing an app?
8. Free season plus a small fee on card payments: would you try it on one route?

## Gaps
- No YouTube transcripts were pulled.
- G2, Software Advice and PlowSite limited direct fetches.
- Capterra has no profile for Yeti's snow product.
- The language need is inferred, not quoted.
