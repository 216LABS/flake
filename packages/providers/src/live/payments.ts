import Stripe from 'stripe';
import type { ChargeResult, PaymentsProvider, StripeEventLike } from '../types';

/**
 * Stripe Connect with direct charges and an application fee. The connected account pays Stripe fees, Stripe
 * owns losses, and the account uses the full Dashboard (ADDENDUM_PAYMENTS section 1). Exercised only through
 * LIVE_PROVIDER_TESTS: the build had no Stripe keys, so these calls have not been run against Stripe.
 */
export class LivePayments implements PaymentsProvider {
  isMock = false;
  private stripe: Stripe;
  /**
   * Stripe signs each webhook endpoint with its own secret, and Connect needs two endpoints: one for this platform's own
   * events (Pro subscriptions) and one for events on the plow companies' accounts (their charges, invoices and
   * onboarding). A delivery is genuine if any one of the secrets verifies it.
   */
  private webhookSecrets: string[];
  constructor(key: string, private publishableKey: string | null, webhookSecrets: string | string[], private prices: { monthly?: string; yearly?: string }) {
    this.webhookSecrets = (Array.isArray(webhookSecrets) ? webhookSecrets : [webhookSecrets]).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
    this.stripe = new Stripe(key);
  }

  async createConnectedAccount(input: { email: string | null; businessName: string; tenantId: string }) {
    const account = await this.stripe.accounts.create({
      email: input.email ?? undefined,
      business_profile: { name: input.businessName },
      metadata: { tenant_id: input.tenantId },
      controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, stripe_dashboard: { type: 'full' } },
    });
    return { accountId: account.id };
  }

  async createAccountLink(accountId: string, returnUrl: string, refreshUrl: string) {
    const link = await this.stripe.accountLinks.create({ account: accountId, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' });
    return { url: link.url };
  }

  async chargesEnabled(accountId: string) {
    return Boolean((await this.stripe.accounts.retrieve(accountId)).charges_enabled);
  }

  async ensureCustomer(accountId: string, input: { existingId?: string | null; email?: string | null; name: string; tenantId: string; customerId: string }) {
    if (input.existingId) return { customerId: input.existingId };
    const c = await this.stripe.customers.create(
      { email: input.email ?? undefined, name: input.name, metadata: { tenant_id: input.tenantId, customer_id: input.customerId } },
      { stripeAccount: accountId, idempotencyKey: `customer:${input.customerId}` },
    );
    return { customerId: c.id };
  }

  async createSetupIntent(accountId: string, customerId: string, metadata: Record<string, string>) {
    const si = await this.stripe.setupIntents.create(
      { customer: customerId, usage: 'off_session', allowed_payment_method_types: ['card', 'us_bank_account'], metadata },
      { stripeAccount: accountId },
    );
    return { id: si.id, clientSecret: si.client_secret!, publishableKey: this.publishableKey, mock: false };
  }

  async chargeOffSession(accountId: string, input: { customerId: string; paymentMethodId: string; amountCents: number; feeCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<ChargeResult> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: 'usd',
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          application_fee_amount: input.feeCents,
          description: input.description,
          metadata: input.metadata,
        },
        { stripeAccount: accountId, idempotencyKey: input.idempotencyKey },
      );
      if (pi.status === 'succeeded') return { status: 'succeeded', paymentIntentId: pi.id, events: [] };
      if (pi.status === 'processing') return { status: 'processing', paymentIntentId: pi.id, events: [] };
      return { status: 'requires_action', paymentIntentId: pi.id, failure: `Payment needs customer action (${pi.status})`, events: [] };
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        const pi = err.payment_intent;
        return { status: pi?.status === 'requires_action' ? 'requires_action' : 'failed', paymentIntentId: pi?.id ?? null, failure: err.message, events: [] };
      }
      throw err;
    }
  }

  async createPayLink(accountId: string, input: { amountCents: number; feeCents: number; description: string; idempotencyKey: string; metadata: Record<string, string> }) {
    const price = await this.stripe.prices.create(
      { currency: 'usd', unit_amount: input.amountCents, product_data: { name: input.description.slice(0, 200) } },
      { stripeAccount: accountId, idempotencyKey: `${input.idempotencyKey}:price` },
    );
    const link = await this.stripe.paymentLinks.create(
      { line_items: [{ price: price.id, quantity: 1 }], application_fee_amount: input.feeCents, metadata: input.metadata, payment_intent_data: { metadata: input.metadata } },
      { stripeAccount: accountId, idempotencyKey: `${input.idempotencyKey}:link` },
    );
    return { id: link.id, url: link.url };
  }

  async createInvoice(accountId: string, input: { customerId: string; lines: { description: string; amountCents: number }[]; feeCents: number; daysUntilDue: number; idempotencyKey: string; description: string; metadata: Record<string, string> }) {
    const opts = (suffix: string) => ({ stripeAccount: accountId, idempotencyKey: `${input.idempotencyKey}:${suffix}` });
    const invoice = await this.stripe.invoices.create(
      {
        customer: input.customerId,
        collection_method: 'send_invoice',
        days_until_due: input.daysUntilDue,
        application_fee_amount: input.feeCents,
        description: input.description,
        metadata: input.metadata,
        auto_advance: false,
        payment_settings: { payment_method_types: ['us_bank_account', 'card'] },
      },
      opts('create'),
    );
    await Promise.all(
      input.lines.map((l, i) => this.stripe.invoiceItems.create({ customer: input.customerId, invoice: invoice.id, amount: l.amountCents, currency: 'usd', description: l.description.slice(0, 500) }, opts(`line${i}`))),
    );
    const finalized = await this.stripe.invoices.finalizeInvoice(invoice.id, {}, opts('finalize'));
    await this.stripe.invoices.sendInvoice(invoice.id, {}, opts('send'));
    return { invoiceId: invoice.id, hostedUrl: finalized.hosted_invoice_url ?? null, events: [] };
  }

  async createProCheckout(input: { tenantId: string; customerId?: string | null; email?: string | null; interval: 'monthly' | 'yearly'; successUrl: string; cancelUrl: string }) {
    const price = this.prices[input.interval];
    if (!price) throw new Error(`STRIPE_PRICE_PRO_${input.interval.toUpperCase()} is not set`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer: input.customerId ?? undefined,
      customer_email: input.customerId ? undefined : input.email ?? undefined,
      client_reference_id: input.tenantId,
      subscription_data: { metadata: { tenant_id: input.tenantId } },
    });
    return { url: session.url! };
  }

  verifyWebhook(rawBody: string, signature: string | null): StripeEventLike {
    if (!this.webhookSecrets.length) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    let last: unknown;
    for (const secret of this.webhookSecrets) {
      try {
        return this.stripe.webhooks.constructEvent(rawBody, signature ?? '', secret) as unknown as StripeEventLike;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }
}
