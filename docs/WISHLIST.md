# Flake: the software plow operators wish they had
Research Nov 6, 2026. Sources: PlowSite threads, r/Snowplow, Capterra, Google Play and AppBrain reviews, SoftwareConnect, SIMA (the snow industry trade group), plus DataForSEO US keyword data. Every quote below is copied from the linked page. The ranking is a judgment based on how often each theme came up across roughly 15 sources, not a statistical count.
**Caveat:** G2, Software Advice and PlowSite thread pages blocked or limited direct fetches, so the PlowSite quotes come from search-result excerpts of those threads. LawnSite didn't come up in the searches. There's almost no independent review base for the snow-specific tools: Yeti's iOS app has 16 ratings and 3 written reviews, per [fervorstudio](https://fervorstudio.ca/news/yeti-snow-review-pricing-alternatives/).

## Top pain points (most frequent first)

**1. Billing after a storm is manual re-keying from paper or spreadsheets into QuickBooks, and it's error-prone**
- "We use Google sheets and Quickbooks online… This has become extremely time consuming and repetitive… snow plowing apps but they all seemed pretty expensive" ([r/Snowplow](https://www.reddit.com/r/Snowplow/comments/1iu4xv5/tracking_plowing_invoices/))
- "good old fashioned clipboard with the plow sheets… then we use quickbooks for invoices" ([r/Snowplow](https://www.reddit.com/r/Snowplow/comments/1wtty6u/how_do_you_small_guys_handle_perpush_billing/))
- On Service Autopilot: "We bill 180 lines a night and found many many errors… 0% confidence in anything that was billed" ([PlowSite](https://www.plowsite.com/threads/software-for-routing-tracking-service-autopilot-or-mhelpdesk.161217/))
- *Where tools fail:* Service Autopilot (billing errors); Jobber (per-push works, but each visit is a separate invoice and the setup is clunky); small operators can't justify the snow-specific tools on cost.

**2. Storm dispatch and snow routing are bolted on in general-purpose tools**
- "you have to put them in zones instead of putting them in a route like I do for mowing" ([Jobber on Capterra](https://www.capterra.com/p/127994/Jobber/reviews/?page=16))
- "not having a way… to efficiently dispatch a large number of clients to each team member at a short notice… 2-3 dispatches… [no way] to notify our drivers through jobber quickly" ([Jobber Community](https://community.getjobber.com/discussions/job-details-scheduling/snowplowing-routing/1713))
- "we find ourselves spending hours moving around routes that were incorrectly assigned" (Service Autopilot, [SoftwareConnect](https://softwareconnect.com/reviews/service-autopilot/))
- *Where tools fail:* Jobber, Service Autopilot.

**3. Proof of service for slip-and-fall liability (timestamps, GPS, before and after photos)**
- SIMA's claims checklist: "Digital time sheets showing service start/end times with before and after photos" ([SIMA](https://resources.sima.org/snow-and-ice-resource-center/protect-others-protect-yourself))
- "a driver at 3am in a storm will not fill out a paper form accurately, so the record either never exists or gets faked up later" ([Icey](https://iceysoftware.com/blog/slip-and-fall-liability-documentation-snow))
- On Yeti: "Too much compression on photos… Clients can't see a thing" ([AppBrain/Google Play](https://www.appbrain.com/app/yeti-software/com.yetisnow.yeti))
- *Where tools fail:* Yeti (photo quality, clunky before-and-after flow); generic tools have no storm-log structure; paper logs fail under scrutiny.

**4. Price creep and add-on fatigue**
- "The cost of the software continues to go up, currently facing another 10% increase, yet the features are not improving" (Service Autopilot, [SoftwareConnect](https://softwareconnect.com/reviews/service-autopilot/))
- "the cost of things is leaving a bad taste in my mouth. Such as all the add on features" ([Jobber on Capterra](https://www.capterra.com/p/127994/Jobber/reviews/?page=16))
- An Aspire blog post lists this disadvantage of Yeti: "can get really expensive, really fast" ([Aspire](https://www.youraspire.com/blog/best-snow-removal-tracking-apps))
- *Where tools fail:* Service Autopilot, Jobber, Yeti, LMN ($297/mo plus onboarding).

**5. Field apps are buggy or clunky in real storm conditions**
- "kills battery very fast" and "clocked me in as different people… Honestly just a text message and an hour sheet accomplishes just as much" (Yeti, [AppBrain](https://www.appbrain.com/app/yeti-software/com.yetisnow.yeti))
- "Smoother transition between taking before/after photos. Especially important on rainy/wet snow nights where touchscreens are a struggle" (same source)
- "So many complicated clunky apps… Same as yeti, absolute crap" ([PlowSite](https://www.plowsite.com/threads/software-for-routing-tracking-service-autopilot-or-mhelpdesk.161217/))

**6. Salt and material tracking**
- SIMA: "Record actual, quantifiable amounts of materials used, including bagged and bulk materials" ([SIMA](https://resources.sima.org/snow-and-ice-resource-center/protect-others-protect-yourself))
- Listed as a Service Autopilot con: "Cannot track actual materials used in real-time" ([SoftwareConnect](https://softwareconnect.com/reviews/service-autopilot/))
- Praised in SG Advantage: "track bulk salt and bagged material in real time… during storms when dealing with subs" ([PlowSite](https://www.plowsite.com/threads/software-for-snow-contracts.185164/))

**7. Per-property contract pricing (per push, per inch, seasonal) lives in spreadsheets**
- "Once in make a bid… does it apply to the property or do i have to keep a spread sheet… We are currently using spread sheets" ([PlowSite](https://www.plowsite.com/threads/software-for-snow-contracts.185164/))
- Jobber supports only per-visit or fixed-price billing, and its documented "Snow Removal Workflow" for storm scheduling is a manual workaround ([Jobber help](https://help.getjobber.com/en/articles/snow-removal-workflow-or-how-to-schedule-new-visits-for-multiple-jobs/))

**8. Managing subcontractors**
- Subs appear as their own sector in the Montana spreadsheet ([r/Snowplow](https://www.reddit.com/r/Snowplow/comments/1iu4xv5/tracking_plowing_invoices/)). A subcontractor complained about Yeti clocking him in as other people (#5 above).
- "On heavy storm nights when subcontractors clear overflow lots, their paper logs rarely make it back to your office" ([TeamProof](https://getteamproof.com/blog/snow-removal-slip-and-fall-documentation-checklist-canada), a vendor post)

**9. When to roll trucks, and keeping the forecast you relied on**
- SIMA: keep "Screen shots or printouts of the forecasts you relied on to mobilize… This forecasted information will not be available again" ([SIMA](https://resources.sima.org/snow-and-ice-resource-center/protect-others-protect-yourself))
- Operators ask "when do I plow?" and "How do you know how much snow has fallen" ([r/Snowplow](https://www.reddit.com/r/Snowplow/comments/1itfkb5/when_do_i_plow/), [r/Snowplow](https://www.reddit.com/r/Snowplow/comments/14cxoja/how_do_you_know_how_much_snow_has_fallen_during_a/))
- *Where tools fail:* almost none tie dispatch to measured snowfall. Most rely on manual storm calls.

**10. Customer communication and getting paid**
- "They also have no automated text or email feature to send customers invoices and updates. I have to manually email each individual customer" (Service Autopilot, [SoftwareConnect](https://softwareconnect.com/reviews/service-autopilot/))
- "a lot of our customers are not receiving the communication… created quite a mess with our receivables" (Jobber, [SoftwareConnect](https://softwareconnect.com/reviews/jobber/))
- One owner's workaround for GPS: "Azuga tracking is like $25/mo per vehicle" on top of his software ([r/Snowplow](https://www.reddit.com/r/Snowplow/comments/1q75rs2/route_plannerinvoice_organizer/)). Another runs Linxup separately from Service Autopilot ([PlowSite](https://www.plowsite.com/threads/software-for-routing-tracking-service-autopilot-or-mhelpdesk.161217/)).

## Keyword data (DataForSEO, US, monthly volume / CPC)
| Keyword | Vol | CPC |
|---|---|---|
| snow removal contract template | 590 | $3.50 |
| snow removal contract(s) | 720 | $6.07 |
| snow plowing contract | 390 | $4.25 |
| snow removal app | 390 | $13.76 |
| commercial snow removal pricing calculator | 480 | $10.28 |
| snow removal seasonal contracts | 320 | $31.36 |
| how much to charge for snow removal | 260 | $4.40 |
| snow plow app | 210 | $9.81 |
| snow plow business | 210 | $5.98 |
| snow removal estimate template | 170 | $6.12 |
| snow removal pricing calculator | 140 | $10.08 |
| snow removal quote | 110 | $10.33 |
| snow removal software | 70 | $33.09 |
| snow plow tracking app | 70 | n/a |
| snow removal invoice template | 70 | $4.70 |
| snow plow software / snow plowing software | 50 | $40.22 |
| snow plow route app | 40 | $46.73 |
| snow plow route planning | 20 | $42.58 |
| snow plow gps tracking / snow plow log / snow removal estimate calculator | 10 each | n/a–$0.22 |
| yeti snow (brand) | 1,300 | $2.98 |
| snow removal pricing (consumer and contractor mix) | 1,000 | $7.61 |

**What the keywords say:** very few people search for "software," but the clicks are expensive ($33–47 CPC), so software companies are paying for those buyers. Operators search for the jobs they need done: **contracts, templates, pricing calculators and quotes** (about 2,000+ searches a month combined). A free snow contract generator plus a pricing calculator on the Flake site is the cheap way in through SEO. Each one can capture leads and lead into the app.

## Recommended v1 feature set
**Must-have (table stakes that should just work)**
1. Properties with contract type per site: per push, per inch tier, per event or seasonal. Plus a salt price.
2. One-tap storm event: "start storm" builds today's route list from the master routes and texts drivers a link. No app install for subs.
3. Driver check-in/out with device timestamp and GPS, before and after photos at full resolution, and a salt quantity. Works offline and syncs later, is battery-light and has glove-sized buttons.
4. Billing in one click after the storm: logs become invoices, with photos attached and salt added. Card on file through Stripe Connect, which is how Flake makes money. QuickBooks Online export.
5. Automatic customer texts: "on the way" and "done," with a photo.

**Differentiators (AI + weather, where nobody is strong)**
- **Weather-triggered dispatch:** pull NWS/NOAA forecasts and observed snowfall per site, then alert the owner when a contract's trigger depth (e.g. 2") is hit. Draft the storm event and driver texts, and save the forecast snapshot for liability (SIMA #10). This addresses pain points #2 and #9.
- **Auto-quotes from property size:** measure lot and sidewalk area from parcel data or satellite imagery, apply the owner's $/sq ft and per-push rates, and send a quote link. This ties into the "pricing calculator" and "how much to charge" searches.
- **Liability packet on demand:** for any site and date, generate a PDF with times, GPS trail, photos, salt and the weather/forecast at that hour. This is what an insurer or lawyer asks for, and no current tool's marketing leads with it.
- **Billing check:** flag missed or duplicate pushes, comparing GPS visits to invoices. This targets the "0% confidence in anything that was billed" complaint.

**Later**
- Subcontractor portal and pay statements, a fuller route optimizer, salt inventory and purchasing, a customer portal, the receptionist line taking "when are you coming" calls, and lawn and landscaping for the off-season.

**Pricing angle:** free first season, with revenue from card-processing fees. This is a direct answer to the price-creep complaints (#4).
