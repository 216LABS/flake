import { and, contract, customer, eq, notInArray, serviceDb, site, sms_consent, tenant, withUser } from '@flake/db';
import { CUSTOMER_CONSENT_TEXT } from '@flake/core/messages';
import { quoteAccept, quoteCreate } from '@flake/contracts';
import { z } from 'zod';
import { baseUrl } from './env';
import { HttpError } from './http';
import { queueNotify, shortLink } from './messaging';
import { getProviders } from './providers';
import { handleStripeEvent } from './billing';
import { putBlob, signedUrl } from './blob';
import { hashToken, newToken } from './tokens';
import type { Ctx } from './storms';

export const DEFAULT_TERMS = `Service is triggered when snowfall reaches the trigger depth listed above, as measured on site or from the weather records kept for this property. The contractor keeps a dated record of each visit. The client will keep the property accessible and mark obstacles before the first snowfall. Either party may end this agreement with 14 days written notice. Payment terms: as stated on each invoice.`;

export async function createQuote(ctx: Ctx, input: z.infer<typeof quoteCreate>) {
  const token = newToken();
  const row = await withUser(ctx.userId, async (tx) => {
    const [st] = await tx.select().from(site).where(eq(site.id, input.site_id));
    if (!st) throw new HttpError(404, 'Site not found');
    const [c] = await tx.insert(contract).values({
      tenant_id: ctx.tenantId, site_id: input.site_id, season: input.season, services: input.services, salt_pricing: input.salt_pricing ?? null,
      terms_md: input.terms_md ?? DEFAULT_TERMS, status: input.send ? 'sent' : 'draft', quote_token_hash: hashToken(token),
    }).returning();
    const [cust] = await tx.select().from(customer).where(eq(customer.id, st.customer_id));
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
    return { contract: c!, customer: cust!, tenant: t! };
  });
  const url = `${baseUrl()}/q/${token}`;
  if (input.send) {
    const link = await shortLink(ctx.tenantId, `/q/${token}`);
    await queueNotify(row.tenant.id, { phone: row.customer.phone_e164, email: row.customer.email }, { template: 'quote', vars: { link }, subject: `${row.tenant.name}: your snow service quote`, key: `quote:${row.contract.id}`, related: { contract_id: row.contract.id } });
  }
  return { contract: row.contract, url, token };
}

async function byToken(token: string) {
  const [row] = await serviceDb().select({ contract, site, customer, tenant }).from(contract)
    .innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, contract.tenant_id))
    .where(eq(contract.quote_token_hash, hashToken(token)));
  if (!row || row.contract.status === 'void') throw new HttpError(404, 'This quote is no longer available', 'quote_dead');
  return row;
}

/** What the customer page shows. Nothing here is Flake's fee or anything internal. */
export async function getQuote(token: string) {
  const r = await byToken(token);
  return {
    company: r.tenant.name,
    customer: { name: r.customer.name, email: r.customer.email, phone: r.customer.phone_e164, billing_mode: r.customer.billing_mode },
    site: { label: r.site.label, address: r.site.address, area_sqft: r.site.area_confirmed_sqft ?? r.site.area_estimate_sqft },
    contract: { id: r.contract.id, season: r.contract.season, services: r.contract.services, salt_pricing: r.contract.salt_pricing, terms_md: r.contract.terms_md, status: r.contract.status, accepted_at: r.contract.accepted_at, accepted_name: r.contract.accepted_name },
    consent_text: CUSTOMER_CONSENT_TEXT(r.tenant.name),
    payments_ready: Boolean(r.tenant.stripe_account_id && r.tenant.stripe_charges_enabled),
    has_payment_method: Boolean(r.customer.stripe_payment_method_id),
  };
}

/** Stores name, IP and time, records consent, and keeps a PDF snapshot of what was accepted. */
export async function acceptQuote(token: string, input: z.infer<typeof quoteAccept>, ip: string | null) {
  const r = await byToken(token);
  if (r.contract.status === 'accepted') return { already: true };
  const db = serviceDb();
  const at = new Date().toISOString();
  const { renderContractPdf } = await import('@flake/providers/pdf');
  const pdf = await renderContractPdf({ company: r.tenant.name, customer: r.customer.name, site: `${r.site.label}, ${r.site.address}`, season: r.contract.season, services: r.contract.services, terms: r.contract.terms_md, acceptance: { name: input.name, at, ip } });
  // Its own file per acceptance, so a second tap that loses the race below can't overwrite the signed copy.
  const pdfPath = `${r.tenant.id}/${r.contract.id}-${Date.parse(at)}.pdf`;
  await putBlob('contracts', pdfPath, pdf, 'application/pdf', { upsert: true });
  // Only the first acceptance counts, and a quote voided meanwhile stays void.
  const took = await db.update(contract).set({ status: 'accepted', accepted_at: at, accepted_name: input.name, accepted_ip: ip && isIp(ip) ? ip : null, pdf_path: pdfPath })
    .where(and(eq(contract.id, r.contract.id), eq(contract.tenant_id, r.tenant.id), notInArray(contract.status, ['accepted', 'void']))).returning({ id: contract.id });
  if (!took.length) {
    const [now] = await db.select({ status: contract.status }).from(contract).where(eq(contract.id, r.contract.id));
    if (now?.status === 'void') throw new HttpError(404, 'This quote is no longer available', 'quote_dead');
    return { already: true };
  }
  const phone = input.phone_e164 ?? r.customer.phone_e164;
  await db.update(customer).set({ notify_sms: input.consentSms && Boolean(phone), notify_email: input.consentEmail, phone_e164: phone }).where(and(eq(customer.id, r.customer.id), eq(customer.tenant_id, r.tenant.id)));
  if (input.consentSms && phone) {
    await db.insert(sms_consent).values({ tenant_id: r.tenant.id, phone_e164: phone, party: 'customer', opted_in_at: at, opted_in_source: 'quote_page' })
      .onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_in_at: at, opted_in_source: 'quote_page', opted_out_at: null } });
  }
  return { already: false };
}

const isIp = (s: string) => /^[0-9a-fA-F:.]+$/.test(s);

export async function contractPdfUrl(tenantId: string, path: string) {
  return path.startsWith(`${tenantId}/`) ? signedUrl('contracts', path) : null;
}

/** SetupIntent on the connected account so the charge later belongs to the plow company. */
export async function createQuoteSetupIntent(token: string) {
  const r = await byToken(token);
  if (!r.tenant.stripe_account_id || !r.tenant.stripe_charges_enabled) throw new HttpError(409, 'This company has not connected payments yet', 'not_connected');
  const { payments } = await getProviders();
  const { customerId } = await payments.ensureCustomer(r.tenant.stripe_account_id, { existingId: r.customer.stripe_customer_id, email: r.customer.email, name: r.customer.name, tenantId: r.tenant.id, customerId: r.customer.id });
  if (customerId !== r.customer.stripe_customer_id) await serviceDb().update(customer).set({ stripe_customer_id: customerId }).where(eq(customer.id, r.customer.id));
  const si = await payments.createSetupIntent(r.tenant.stripe_account_id, customerId, { tenant_id: r.tenant.id, customer_id: r.customer.id });
  return { clientSecret: si.clientSecret, publishableKey: si.publishableKey, stripeAccount: r.tenant.stripe_account_id, mock: si.mock };
}

/** Mock mode only: stands in for the Payment Element. Card ending 0002 stores a method that will decline. */
export async function mockConfirmSetup(token: string, input: { card?: string; bank?: boolean }) {
  const r = await byToken(token);
  const { payments } = await getProviders();
  if (!payments.isMock) throw new HttpError(404, 'Not found');
  const pm = input.bank ? 'pm_mock_bank' : `pm_mock_${(input.card ?? '4242').slice(-4)}`;
  await handleStripeEvent({
    id: `evt_mock_seti_${r.customer.id}_${pm}`,
    type: 'setup_intent.succeeded',
    account: r.tenant.stripe_account_id ?? undefined,
    data: { object: { id: `seti_mock_${r.customer.id}`, customer: r.customer.stripe_customer_id, payment_method: pm, metadata: { tenant_id: r.tenant.id, customer_id: r.customer.id } } },
  });
  return { payment_method: pm };
}
