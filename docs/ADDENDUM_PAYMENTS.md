# Addendum — Payments (Stripe Connect) (v1.0)
Sources and rationale: DECISIONS D5.

## 1. Model
- The platform is the Flake Stripe account (216LABS LLC). Note: Stripe has asked 216LABS for a valid tax ID. That must be resolved before going live.
- Connected accounts: created with controller properties so that **the account pays Stripe fees, Stripe is liable for losses, and the account uses the full Stripe Dashboard** (equivalent to Standard). There are no Connect $2/active or payout fees in this model [V: stripe.com/connect/pricing]. [T: confirm the exact `controller` params / Accounts v2 `fees_collector=stripe` at build time.]
- Onboarding: Stripe-hosted Account Link from /settings/payments. Store `charges_enabled` from `account.updated`.
- **Direct charges** on the connected account (`Stripe-Account` header) with `application_fee_amount`.

## 2. Fee calculation (packages/core/fees.ts)
- `fee = clamp(round(amount × rate), 50, 2500)` cents. Rate = 0.01 (free) or 0.005 (pro).
- When `free_season_until` ≥ today, the Pro monthly charge is waived, but the application fee still applies.
- Show the owner the estimated Stripe fee (card 2.9% + 30¢; ACH 0.8% capped at $5) [V: stripe.com/pricing] and the Flake fee per invoice in billing review. Customers never see the Flake fee.

## 3. Flows
- **Card or ACH on file:** `/q/[token]` → SetupIntent on the connected account (`payment_method_types: card, us_bank_account`, `usage: off_session`) using the Payment Element. On `setup_intent.succeeded`, store the customer + PM.
- **Charge after storm:** approved draft → PaymentIntent (`off_session: true, confirm: true, application_fee_amount`, `idempotency_key = draft.id`). On `requires_action`/failure → create a Stripe hosted invoice or Payment Link and email it.
- **Net-30 commercial:** Stripe Invoice on the connected account, `collection_method=send_invoice`, `days_until_due=30`, `application_fee_amount`, lines from the draft with a description that includes the storm and visit times. Invoicing adds 0.4%/paid invoice [V]. ACH (bank transfer) is the preferred method.
- **Seasonal contracts:** installment invoices on a schedule (one Stripe Invoice per installment, at most one per lot per month, from a daily job), not Stripe Subscriptions, to keep fee logic uniform. Without payments connected, each installment is recorded as "Bill it yourself" and marked paid by the office.
- **Refunds/disputes:** the owner issues them in their own Stripe Dashboard. Flake mirrors status via webhooks and links the disputed invoice to its proof packet ("Generate evidence").
- **Pro plan:** a normal Stripe Billing subscription on the **platform** account for the tenant (price ids in env).

## 4. Webhooks
`/api/webhooks/stripe` with Connect events enabled: `account.updated`, `setup_intent.succeeded`, `payment_intent.succeeded|payment_failed|requires_action`, `invoice.paid|payment_failed|finalized`, `charge.dispute.created|closed`, `charge.refunded`, `customer.subscription.*`. Verify the signature on the raw body; dedupe on `stripe_event.id`.

## 5. Mock mode
`MockPayments` simulates accounts (charges_enabled after 1 click), SetupIntents (test card 4242 behavior), and a decline with card ending 0002. It emits the same webhook-shaped events into the handler. The billing e2e runs fully in mock mode.

## 6. Tests
Fee clamp/rounding; idempotent approve; failed → pay link; invoice net-30 creation shape; webhook dedupe; the tenant can only see its own payments.
