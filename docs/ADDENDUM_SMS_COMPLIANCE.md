# Addendum — SMS and Compliance (v1.0)
Sources and rationale: DECISIONS D6.

## 1. Architecture (Twilio ISV)
- One Twilio **subaccount per tenant**. A Secondary Customer Profile carries the tenant's business info. **One toll-free number per tenant** goes through Toll-Free Verification submitted via the API in the tenant's legal name with its business registration number (EIN), required since Feb 17, 2026 except for sole proprietors [V]. Expect 3–5 business days [V]. Flake's own Primary Customer Profile must be approved first [V].
- `tenant.sms_status`: none → pending → approved|rejected. Rejection reasons are shown in settings with a fix-and-resubmit flow.
- **Before approval (and always as a fallback):** crew links go by email and an on-screen QR / "copy link" in the dashboard; customer notices go by email. Never send SMS from a shared Flake number on a tenant's behalf.
- 10DLC (brand $4.50 / $46 with vetting, campaign $15 vetting + $10/mo, ~7 business days [V]) is listed under Later.

## 2. Verification payload (store and prefill in settings)
Legal business name, EIN, business address, website (or the Flake-hosted business page `flake.216labs.dev/b/{slug}`), contact name/email/phone, use case "Account notifications / customer care," expected monthly volume, and opt-in description + screenshot URL (Flake generates the tenant's public opt-in page `/b/{slug}/sms` showing the consent language). Sample messages are listed below.

## 3. Consent
- **Crew:** the invite page `/join/{token}` has an unchecked checkbox: "Text me route links and storm call-outs from {Company}. Msg & data rates may apply. Reply STOP to opt out, HELP for help." Store it in `sms_consent` (source=crew_invite).
- **Customers:** the quote/contract page has an unchecked checkbox: "Text me service updates (on the way, completed with photo, invoices) from {Company}…". It's not required to accept the contract.
- Never text anyone without a consent row. Honor STOP/START/HELP (Twilio Advanced Opt-Out plus mirroring in `sms_consent`).
- Quiet hours don't apply to crew storm messages or to service notices the customer requested (storms happen at 3 AM). Invoice texts only go out 8 AM–8 PM local.

## 4. Templates (≤ 2 segments, company name first)
- Crew link: `{Company}: Storm on. Route {route} – {n} stops. Start: {short_link} Reply STOP to opt out.`
- Call-out: `{Company}: Plowing expected ~{time}. Can you run {route}? Reply YES or NO.` (inbound YES/NO is parsed and shown on the dashboard)
- On the way: `{Company}: Your plow is on the way to {site_label}.`
- Done: `{Company}: {site_label} cleared at {time}. Photo: {short_link}`
- Late: `{Company}: Heavy snow is slowing routes. We expect to reach {site_label} by {time}.`
- Invoice: `{Company}: Invoice for {storm} – ${amount}. View/pay: {short_link}`
- HELP: `{Company} service texts via Flake. Contact {phone}. Reply STOP to opt out.`
Short links use `flake.216labs.dev/s/{code}` (own shortener; no public URL shorteners, since carriers filter them).

## 5. Email
Resend from `notifications@flake.216labs.dev` with the tenant name as the display name and reply-to set to the tenant email. SPF/DKIM/DMARC are configured on the subdomain. Transactional only.

## 6. Other compliance
- Privacy policy says no mobile info is shared with third parties or affiliates for marketing (a TCR/Twilio requirement) [V: Twilio quickstart].
- Location data: driver GPS is captured only while the route page is open and only during an active storm. This is disclosed on the join page. No background tracking.
- Data retention: visits, photos and weather snapshots are kept 7 years by default (claims arrive months to years later). The tenant can export. Deletion requires owner confirmation and is blocked for records under an open dispute.
- The contract builder tool and terms state "not legal advice."

## 7. Mock mode
`MockSms` writes to `message_log` and shows the messages at `/dev/inbox`. Inbound STOP/YES is simulated with a button there. Toll-free verification auto-approves after 10 s in mock mode.
