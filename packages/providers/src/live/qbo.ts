import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AccountingProvider, QboAuth, QboCustomer, QboInvoiceInput, QboInvoiceRef, QboItem, QboTokens } from '../types';

const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR = '75';

const cents = (n: unknown) => Math.round(Number(n ?? 0) * 100);
const dollars = (c: number) => Number((c / 100).toFixed(2));

/** QuickBooks Online through Intuit's REST API (issue 162). The sandbox unless QBO_ENV=production. */
export class LiveAccounting implements AccountingProvider {
  configured = true;
  isMock = false;
  private api: string;
  constructor(private clientId: string, private clientSecret: string, private verifier: string | undefined, env: string | undefined) {
    this.api = env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
  }

  authorizeUrl(state: string, redirectUri: string) {
    const u = new URL(AUTHORIZE);
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  private async token(form: Record<string, string>, realmId: string): Promise<QboTokens> {
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(10_000),
    });
    // The body can hold tokens: only the status goes in the error.
    if (!res.ok) throw new Error(`QuickBooks sign-in failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { access: j.access_token, refresh: j.refresh_token, expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(), realmId };
  }
  exchange(code: string, realmId: string, redirectUri: string) {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, realmId);
  }
  refresh(refreshToken: string, realmId: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }, realmId);
  }
  async revoke(refreshToken: string) {
    await fetch(REVOKE, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  private async call<T>(a: QboAuth, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
    const u = new URL(`${this.api}/v3/company/${encodeURIComponent(a.realmId)}/${path}`);
    u.searchParams.set('minorversion', MINOR);
    for (const [k, v] of Object.entries(init.query ?? {})) u.searchParams.set(k, v);
    const res = await fetch(u, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${a.access}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // Intuit's fault detail says what was wrong (a duplicate name, a bad item) and carries no secrets.
      let detail = '';
      try {
        const f = (JSON.parse(text) as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } }).Fault?.Error?.[0];
        detail = f ? `${f.code ?? ''} ${f.Message ?? ''}: ${f.Detail ?? ''}`.trim() : '';
      } catch { /* not JSON */ }
      throw Object.assign(new Error(`QuickBooks ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`), { status: res.status });
    }
    return JSON.parse(text) as T;
  }
  private query<T>(a: QboAuth, q: string) {
    return this.call<{ QueryResponse: Record<string, T[] | undefined> }>(a, 'query', { query: { query: q } });
  }

  async listCustomers(a: QboAuth): Promise<QboCustomer[]> {
    const out: QboCustomer[] = [];
    for (let start = 1; start < 10_000; start += 1000) {
      const r = await this.query<{ Id: string; DisplayName: string; PrimaryEmailAddr?: { Address?: string } }>(a, `select Id, DisplayName, PrimaryEmailAddr from Customer where Active = true startposition ${start} maxresults 1000`);
      const page = r.QueryResponse.Customer ?? [];
      out.push(...page.map((c) => ({ id: c.Id, name: c.DisplayName, email: c.PrimaryEmailAddr?.Address ?? null })));
      if (page.length < 1000) break;
    }
    return out;
  }
  async createCustomer(a: QboAuth, c: { name: string; email: string | null }) {
    const r = await this.call<{ Customer: { Id: string; DisplayName: string } }>(a, 'customer', { method: 'POST', body: { DisplayName: c.name.slice(0, 500), ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}) } });
    return { id: r.Customer.Id, name: r.Customer.DisplayName, email: c.email };
  }
  async listItems(a: QboAuth): Promise<QboItem[]> {
    const r = await this.query<{ Id: string; Name: string }>(a, `select Id, Name from Item where Active = true and Type in ('Service', 'NonInventory') maxresults 1000`);
    return (r.QueryResponse.Item ?? []).map((i) => ({ id: i.Id, name: i.Name }));
  }
  async createInvoice(a: QboAuth, inv: QboInvoiceInput, requestId: string): Promise<QboInvoiceRef> {
    const r = await this.call<{ Invoice: { Id: string; SyncToken: string; TotalAmt: number; Balance: number } }>(a, 'invoice', {
      method: 'POST',
      query: { requestid: requestId.slice(0, 50) },
      body: {
        CustomerRef: { value: inv.customerId },
        DocNumber: inv.docNumber.slice(0, 21),
        TxnDate: inv.txnDate,
        DueDate: inv.dueDate,
        PrivateNote: inv.memo.slice(0, 4000),
        CustomerMemo: { value: inv.memo.slice(0, 1000) },
        Line: inv.lines.map((l) => ({
          DetailType: 'SalesItemLineDetail',
          Amount: dollars(l.amountCents),
          Description: l.description.slice(0, 4000),
          SalesItemLineDetail: { ItemRef: { value: l.itemId }, Qty: l.qty, UnitPrice: dollars(l.rateCents) },
        })),
      },
    });
    return { id: r.Invoice.Id, syncToken: r.Invoice.SyncToken, totalCents: cents(r.Invoice.TotalAmt), balanceCents: cents(r.Invoice.Balance) };
  }
  async getInvoice(a: QboAuth, id: string): Promise<QboInvoiceRef | null> {
    try {
      const r = await this.call<{ Invoice: { Id: string; SyncToken: string; TotalAmt: number; Balance: number } }>(a, `invoice/${encodeURIComponent(id)}`);
      return { id: r.Invoice.Id, syncToken: r.Invoice.SyncToken, totalCents: cents(r.Invoice.TotalAmt), balanceCents: cents(r.Invoice.Balance) };
    } catch (e) {
      // A deleted invoice reads as "Object Not Found" (400) or 404.
      if ([400, 404].includes((e as { status?: number }).status ?? 0) && /not found|610/i.test((e as Error).message)) return null;
      throw e;
    }
  }
  async createPayment(a: QboAuth, p: { customerId: string; invoiceId: string; amountCents: number; txnDate: string; ref: string }, requestId: string) {
    const r = await this.call<{ Payment: { Id: string } }>(a, 'payment', {
      method: 'POST',
      query: { requestid: requestId.slice(0, 50) },
      body: { CustomerRef: { value: p.customerId }, TotalAmt: dollars(p.amountCents), TxnDate: p.txnDate, PaymentRefNum: p.ref.slice(0, 21), Line: [{ Amount: dollars(p.amountCents), LinkedTxn: [{ TxnId: p.invoiceId, TxnType: 'Invoice' }] }] },
    });
    return { id: r.Payment.Id };
  }
  verifyWebhook(body: string, signature: string | null) {
    if (!this.verifier || !signature) return false;
    const want = createHmac('sha256', this.verifier).update(body).digest();
    const got = Buffer.from(signature, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  }
}

/** No Intuit keys on this server: Settings says QuickBooks isn't set up, and nothing tries to sync. */
export function noAccounting(): AccountingProvider {
  const no = async (): Promise<never> => { throw new Error('QuickBooks is not set up on this server'); };
  return { configured: false, isMock: false, authorizeUrl: () => '', exchange: no, refresh: no, revoke: async () => {}, listCustomers: no, createCustomer: no, listItems: no, createInvoice: no, getInvoice: no, createPayment: no, verifyWebhook: () => false };
}
