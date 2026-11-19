import { createHmac, randomUUID } from 'node:crypto';
import type { AccountingProvider, QboAuth, QboCustomer, QboInvoiceInput, QboInvoiceRef, QboItem, QboTokens } from '../types';

export const MOCK_QBO_VERIFIER = 'mock-qbo-verifier';

interface Company {
  customers: QboCustomer[];
  items: QboItem[];
  invoices: Map<string, QboInvoiceRef & { input: QboInvoiceInput }>;
  payments: { id: string; invoiceId: string; amountCents: number }[];
  requests: Map<string, unknown>;
}

/** One fake QuickBooks company per realm, for as long as the server runs. */
const companies = new Map<string, Company>();

/** A test's handle on the fake company: add customers, take a payment, edit or delete an invoice. */
export function mockQbo(realmId: string): Company {
  let c = companies.get(realmId);
  if (!c) {
    c = {
      customers: [{ id: '1', name: 'Amy\'s Bird Sanctuary', email: 'birds@example.com' }, { id: '2', name: 'Lakewood Medical Center', email: 'facilities@example.com' }],
      items: [{ id: '10', name: 'Snow Plowing' }, { id: '11', name: 'Salt' }, { id: '12', name: 'Sidewalk Clearing' }, { id: '13', name: 'Snow Hauling' }, { id: '14', name: 'Seasonal Contract' }, { id: '15', name: 'Services' }],
      invoices: new Map(),
      payments: [],
      requests: new Map(),
    };
    companies.set(realmId, c);
  }
  return c;
}

export function signMockQbo(body: string) {
  return createHmac('sha256', MOCK_QBO_VERIFIER).update(body).digest('base64');
}

const later = () => new Date(Date.now() + 3_600_000).toISOString();

/** Stands in for Intuit outside production. Connect goes straight back to the callback with a fake company. */
export class MockAccounting implements AccountingProvider {
  configured = true;
  isMock = true;
  constructor(private baseUrl: string) {}
  authorizeUrl(state: string, redirectUri: string) {
    const u = new URL(redirectUri, this.baseUrl);
    u.searchParams.set('code', 'mock-code');
    u.searchParams.set('realmId', `mock-${randomUUID().slice(0, 8)}`);
    u.searchParams.set('state', state);
    return u.toString();
  }
  async exchange(code: string, realmId: string): Promise<QboTokens> {
    if (code !== 'mock-code') throw new Error('Mock QuickBooks: bad code');
    mockQbo(realmId);
    return { access: `mock-access-${realmId}`, refresh: `mock-refresh-${realmId}`, expiresAt: later(), realmId };
  }
  async refresh(refreshToken: string, realmId: string): Promise<QboTokens> {
    if (refreshToken === 'mock-revoked') throw new Error('Mock QuickBooks: invalid_grant');
    return { access: `mock-access-${realmId}-${Date.now()}`, refresh: refreshToken, expiresAt: later(), realmId };
  }
  async revoke() {}
  async listCustomers(a: QboAuth) { return [...mockQbo(a.realmId).customers]; }
  async createCustomer(a: QboAuth, c: { name: string; email: string | null }) {
    const co = mockQbo(a.realmId);
    if (co.customers.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) throw new Error('Mock QuickBooks 6240: Duplicate Name Exists Error');
    const made = { id: String(100 + co.customers.length), name: c.name, email: c.email };
    co.customers.push(made);
    return made;
  }
  async listItems(a: QboAuth) { return [...mockQbo(a.realmId).items]; }
  async createInvoice(a: QboAuth, inv: QboInvoiceInput, requestId: string): Promise<QboInvoiceRef> {
    const co = mockQbo(a.realmId);
    const seen = co.requests.get(requestId) as QboInvoiceRef | undefined;
    if (seen) return seen;
    if (!co.customers.some((c) => c.id === inv.customerId)) throw new Error('Mock QuickBooks 2500: Invalid Reference Id: customer');
    const total = inv.lines.reduce((s, l) => s + l.amountCents, 0);
    const ref = { id: String(1000 + co.invoices.size), syncToken: '0', totalCents: total, balanceCents: total };
    co.invoices.set(ref.id, { ...ref, input: inv });
    co.requests.set(requestId, ref);
    return ref;
  }
  async getInvoice(a: QboAuth, id: string) {
    const inv = mockQbo(a.realmId).invoices.get(id);
    return inv ? { id: inv.id, syncToken: inv.syncToken, totalCents: inv.totalCents, balanceCents: inv.balanceCents } : null;
  }
  async createPayment(a: QboAuth, p: { customerId: string; invoiceId: string; amountCents: number; txnDate: string; ref: string }, requestId: string) {
    const co = mockQbo(a.realmId);
    const seen = co.requests.get(requestId) as { id: string } | undefined;
    if (seen) return seen;
    const inv = co.invoices.get(p.invoiceId);
    if (!inv) throw new Error('Mock QuickBooks 610: Object Not Found');
    inv.balanceCents = Math.max(0, inv.balanceCents - p.amountCents);
    inv.syncToken = String(Number(inv.syncToken) + 1);
    const pay = { id: `P${co.payments.length + 1}`, invoiceId: p.invoiceId, amountCents: p.amountCents };
    co.payments.push(pay);
    co.requests.set(requestId, { id: pay.id });
    return { id: pay.id };
  }
  verifyWebhook(body: string, signature: string | null) {
    return Boolean(signature) && signature === signMockQbo(body);
  }
}
