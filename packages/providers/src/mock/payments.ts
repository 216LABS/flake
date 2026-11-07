import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ChargeResult, PaymentsProvider, StripeEventLike } from '../types';

export const MOCK_WEBHOOK_SECRET = 'whsec_mock';

/** Same t=...,v1=... scheme as Stripe, so the webhook route is exercised the same way in tests. */
export function signMockWebhook(rawBody: string, secret = MOCK_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const event = (type: string, account: string, key: string, object: unknown): StripeEventLike => ({ id: `evt_mock_${short(`${type}:${key}`)}`, type, account, data: { object } });

/** Deterministic Stripe stand-in. Card ending 0002 declines; 4242 and bank accounts succeed. */
export class MockPayments implements PaymentsProvider {
  isMock = true;
  constructor(private baseUrl: string) {}

  async createConnectedAccount(input: { tenantId: string }) {
    return { accountId: `acct_mock_${short(input.tenantId)}` };
  }
  async createAccountLink(accountId: string) {
    return { url: `${this.baseUrl}/dev/stripe-onboard?account=${accountId}` };
  }
  async ensureCustomer(_accountId: string, input: { existingId?: string | null; customerId: string }) {
    return { customerId: input.existingId ?? `cus_mock_${short(input.customerId)}` };
  }
  async createSetupIntent(_accountId: string, customerId: string) {
    const id = `seti_mock_${short(customerId)}`;
    return { id, clientSecret: `${id}_secret`, publishableKey: null, mock: true };
  }
  async chargeOffSession(accountId: string, input: { paymentMethodId: string; amountCents: number; feeCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<ChargeResult> {
    const paymentIntentId = `pi_mock_${short(input.idempotencyKey)}`;
    const object = { id: paymentIntentId, amount: input.amountCents, application_fee_amount: input.feeCents, metadata: input.metadata };
    if (input.paymentMethodId.endsWith('0002')) {
      return { status: 'failed', paymentIntentId, failure: 'Your card was declined.', events: [event('payment_intent.payment_failed', accountId, input.idempotencyKey, { ...object, last_payment_error: { message: 'Your card was declined.' } })] };
    }
    return { status: 'succeeded', paymentIntentId, events: [event('payment_intent.succeeded', accountId, input.idempotencyKey, object)] };
  }
  async createPayLink(_accountId: string, input: { idempotencyKey: string }) {
    const id = `plink_mock_${short(input.idempotencyKey)}`;
    return { id, url: `${this.baseUrl}/dev/pay/${id}` };
  }
  async createInvoice(accountId: string, input: { lines: { amountCents: number }[]; feeCents: number; daysUntilDue: number; idempotencyKey: string; metadata: Record<string, string> }) {
    const invoiceId = `in_mock_${short(input.idempotencyKey)}`;
    const total = input.lines.reduce((s, l) => s + l.amountCents, 0);
    const object = { id: invoiceId, collection_method: 'send_invoice', days_until_due: input.daysUntilDue, application_fee_amount: input.feeCents, amount_due: total, metadata: input.metadata };
    return { invoiceId, hostedUrl: `${this.baseUrl}/dev/pay/${invoiceId}`, events: [event('invoice.finalized', accountId, input.idempotencyKey, object)] };
  }
  async createProCheckout(input: { tenantId: string; successUrl: string }) {
    return { url: `${this.baseUrl}/dev/stripe-onboard?pro=${input.tenantId}` };
  }
  verifyWebhook(rawBody: string, signature: string | null): StripeEventLike {
    const parts = Object.fromEntries((signature ?? '').split(',').map((p) => p.split('=') as [string, string]));
    const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest();
    const given = Buffer.from(parts.v1 ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('Invalid webhook signature');
    return JSON.parse(rawBody) as StripeEventLike;
  }
}
