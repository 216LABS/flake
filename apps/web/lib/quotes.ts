import { and, asService, contract, customer, desc, eq, gt, inArray, isNotNull, ne, notInArray, or, serviceDb, site, sms_consent, tenant, withUser } from '@flake/db';
import { paymentText } from './scope';
import { CUSTOMER_CONSENT_TEXT } from '@flake/core/messages';
import { quoteAccept, quoteCreate, quoteDecline } from '@flake/contracts';
import { z } from 'zod';
import { baseUrl } from './env';
import { HttpError } from './http';
import { notifyOffice, plainText, queueNotify, shortLink } from './messaging';
import { getProviders } from './providers';
import { handleStripeEvent } from './billing';
import { putBlob, signedUrl } from './blob';
import { decryptToken, encryptToken, hashToken, newToken } from './tokens';
import type { Ctx } from './storms';

export const DEFAULT_TERMS = `Service starts when snowfall reaches the trigger listed above for each service (with any measurable snow where it says so), as measured on site or from the weather records kept for this property. The contractor keeps a dated record of each visit. The client will keep the property accessible and mark obstacles before the first snowfall. Either party may end this agreement with 14 days written notice. Payment terms: as stated on each invoice.`;

export async function createQuote(ctx: Ctx, input: z.infer<typeof quoteCreate>) {
  let token = newToken();
  const row = await withUser(ctx.userId, async (tx) => {
    const [st] = await tx.select().from(site).where(eq(site.id, input.site_id));
    if (!st) throw new HttpError(404, 'Site not found');
    if (!st.active) throw new HttpError(409, 'This site was retired. Add it again to quote it.', 'site_retired');
    // Only the server writes a quote's token hash and, later, its acceptance (issue 8). A new quote for a lot and season
    // takes the place of any earlier one still waiting for an answer, so the customer can't sign an older, different price.
    const [c] = await asService(tx, ctx.tenantId, async () => {
      await tx.update(contract).set({ status: 'void' }).where(and(eq(contract.tenant_id, ctx.tenantId), eq(contract.site_id, input.site_id), eq(contract.season, input.season), inArray(contract.status, ['draft', 'sent'])));
      // One quote per customer and season (issue 101): a lot quoted while another of theirs still waits for a signature
      // joins that quote's link, so the customer signs once for all of them. A link they already have keeps working.
      const [waiting] = await tx.select({ enc: contract.quote_token_enc }).from(contract).innerJoin(site, eq(site.id, contract.site_id))
        .where(and(eq(contract.tenant_id, ctx.tenantId), eq(site.customer_id, st.customer_id), eq(site.active, true), eq(contract.season, input.season), inArray(contract.status, ['draft', 'sent']), isNotNull(contract.quote_token_enc)))
        .orderBy(desc(contract.created_at)).limit(1);
      if (waiting?.enc) token = decryptToken(waiting.enc);
      return tx.insert(contract).values({
      tenant_id: ctx.tenantId, site_id: input.site_id, season: input.season, services: input.services, salt_pricing: input.salt_pricing ?? null,
      terms_md: input.terms_md ?? DEFAULT_TERMS, status: input.send ? 'sent' : 'draft', quote_token_hash: hashToken(token), quote_token_enc: encryptToken(token),
      }).returning();
    });
    const [cust] = await tx.select().from(customer).where(eq(customer.id, st.customer_id));
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
    const lots = await asService(tx, ctx.tenantId, () => tx.select({ id: contract.id }).from(contract).where(and(eq(contract.tenant_id, ctx.tenantId), eq(contract.quote_token_hash, hashToken(token)), inArray(contract.status, ['draft', 'sent']))));
    return { contract: c!, customer: cust!, tenant: t!, lots: lots.length };
  });
  const url = `${baseUrl()}/q/${token}`;
  if (input.send) {
    const link = await shortLink(ctx.tenantId, `/q/${token}`);
    await queueNotify(row.tenant.id, { phone: row.customer.phone_e164, email: row.customer.email }, { template: 'quote', vars: { link }, subject: `${row.tenant.name}: your snow service quote`, key: `quote:${row.contract.id}`, related: { contract_id: row.contract.id } });
  }
  return { contract: row.contract, url, token, lots: row.lots };
}

/**
 * Every lot on a quote link (issue 101), newest first. A lot whose quote was replaced or voided drops off; the link is
 * dead only when none is left. The first lot stands for the quote where one is needed (company, customer).
 */
async function byToken(token: string) {
  const rows = await serviceDb().select({ contract, site, customer, tenant }).from(contract)
    .innerJoin(site, eq(site.id, contract.site_id)).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, contract.tenant_id))
    .where(eq(contract.quote_token_hash, hashToken(token))).orderBy(desc(contract.created_at));
  if (!rows.length) throw new HttpError(404, 'This quote is no longer available', 'quote_dead');
  const lots: typeof rows = [];
  for (const r of rows) if (r.contract.status !== 'void' && (r.contract.status === 'accepted' || !(await newerQuote(r.contract)))) lots.push(r);
  if (!lots.length) {
    const row = rows[0]!;
    if (await newerQuote(row.contract)) throw new HttpError(410, `${row.tenant.name} sent you a newer quote for ${row.site.label}. Open the link in their latest message.`, 'quote_replaced');
    throw new HttpError(404, 'This quote is no longer available', 'quote_dead');
  }
  return { ...lots[0]!, lots };
}

/** A later quote or agreement for the same lot and season that is still live. An older link then can't be signed. */
async function newerQuote(c: typeof contract.$inferSelect) {
  const [n] = await serviceDb().select({ id: contract.id }).from(contract)
    .where(and(eq(contract.tenant_id, c.tenant_id), eq(contract.site_id, c.site_id), eq(contract.season, c.season), ne(contract.status, 'void'), gt(contract.created_at, c.created_at!))).limit(1);
  return Boolean(n);
}

/** What the customer page shows. Nothing here is Flake's fee or anything internal. */
export async function getQuote(token: string) {
  const r = await byToken(token);
  const view = (c: typeof contract.$inferSelect) => ({ id: c.id, season: c.season, services: c.services, salt_pricing: c.salt_pricing, terms_md: c.terms_md, status: c.status, accepted_at: c.accepted_at, accepted_name: c.accepted_name, declined_at: c.declined_at });
  return {
    company: r.tenant.name,
    lots: r.lots.map((l) => ({ site: { label: l.site.label, address: l.site.address, area_sqft: l.site.area_confirmed_sqft ?? l.site.area_estimate_sqft }, contract: view(l.contract) })),
    customer: { name: r.customer.name, email: r.customer.email, phone: r.customer.phone_e164, billing_mode: r.customer.billing_mode },
    site: { label: r.site.label, address: r.site.address, area_sqft: r.site.area_confirmed_sqft ?? r.site.area_estimate_sqft },
    contract: { id: r.contract.id, season: r.contract.season, services: r.contract.services, salt_pricing: r.contract.salt_pricing, terms_md: r.contract.terms_md, status: r.contract.status, accepted_at: r.contract.accepted_at, accepted_name: r.contract.accepted_name, declined_at: r.contract.declined_at },
    consent_text: CUSTOMER_CONSENT_TEXT(r.tenant.name),
    payments_ready: Boolean(r.tenant.stripe_account_id && r.tenant.stripe_charges_enabled),
    has_payment_method: Boolean(r.customer.stripe_payment_method_id),
  };
}

/**
 * Stores name, IP and time, records consent, and keeps a PDF snapshot of what was accepted. One signature accepts every
 * lot on the link (issue 101), each with its own agreement and PDF.
 */
export async function acceptQuote(token: string, input: z.infer<typeof quoteAccept>, ip: string | null) {
  const b = await byToken(token);
  const at = new Date().toISOString();
  const results: string[] = [];
  for (const lot of b.lots) if (lot.contract.status !== 'accepted') results.push(await acceptLot(lot, input, ip, at));
  if (!results.includes('took')) {
    if (results.length && results.every((x) => x === 'void')) throw new HttpError(404, 'This quote is no longer available', 'quote_dead');
    return { already: true };
  }
  const db = serviceDb();
  const r = b;
  const phone = input.phone_e164 ?? r.customer.phone_e164;
  await db.update(customer).set({ notify_sms: input.consentSms && Boolean(phone), notify_email: input.consentEmail, phone_e164: phone }).where(and(eq(customer.id, r.customer.id), eq(customer.tenant_id, r.tenant.id)));
  if (input.consentSms && phone) {
    await db.insert(sms_consent).values({ tenant_id: r.tenant.id, phone_e164: phone, party: 'customer', opted_in_at: at, opted_in_source: 'quote_page' })
      .onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_in_at: at, opted_in_source: 'quote_page', opted_out_at: null } });
  }
  return { already: false };
}

type Lot = Awaited<ReturnType<typeof byToken>>['lots'][number];

async function acceptLot(r: Lot, input: z.infer<typeof quoteAccept>, ip: string | null, at: string): Promise<'took' | 'void' | 'already'> {
  const db = serviceDb();
  const { renderContractPdf } = await import('@flake/providers/pdf');
  const pdf = await renderContractPdf({ company: r.tenant.name, customer: r.customer.name, site: `${r.site.label}, ${r.site.address}`, season: r.contract.season, services: r.contract.services, payment: paymentText(r.customer.billing_mode, r.tenant.name, Boolean(r.tenant.stripe_account_id && r.tenant.stripe_charges_enabled)), terms: r.contract.terms_md, acceptance: { name: input.name, at, ip } });
  // Its own file per acceptance, so a second tap that loses the race below can't overwrite the signed copy.
  const pdfPath = `${r.tenant.id}/${r.contract.id}-${Date.parse(at)}.pdf`;
  await putBlob('contracts', pdfPath, pdf, 'application/pdf', { upsert: true });
  // Only the first acceptance counts, and a quote voided meanwhile stays void.
  const took = await db.update(contract).set({ status: 'accepted', accepted_at: at, accepted_name: input.name, accepted_ip: ip && isIp(ip) ? ip : null, pdf_path: pdfPath })
    .where(and(eq(contract.id, r.contract.id), eq(contract.tenant_id, r.tenant.id), notInArray(contract.status, ['accepted', 'void']))).returning({ id: contract.id });
  if (!took.length) {
    const [now] = await db.select({ status: contract.status }).from(contract).where(eq(contract.id, r.contract.id));
    return now?.status === 'void' ? 'void' : 'already';
  }
  // A new signature for the same lot and season replaces the old agreement, so only one price is in force. Seasonal
  // installments already billed on it carry over, so a re-sign doesn't start the schedule again (issue 10). Invoices
  // already sent on the old agreement stay owed.
  const replaced = await db.update(contract).set({ status: 'void' }).where(and(eq(contract.tenant_id, r.tenant.id), eq(contract.site_id, r.contract.site_id), eq(contract.season, r.contract.season), eq(contract.status, 'accepted'), ne(contract.id, r.contract.id))).returning({ billed: contract.installments_billed });
  const carried = Math.max(0, ...replaced.map((x) => x.billed));
  if (carried) await db.update(contract).set({ installments_billed: carried }).where(eq(contract.id, r.contract.id));
  return 'took';
}

/**
 * The customer turns the quote down (issue 59). The office hears about it at once, and the quote shows as declined on
 * the site page instead of waiting forever. The customer can still accept later from the same link if they change their
 * mind; a signed or voided quote can't be declined.
 */
export async function declineQuote(token: string, input: z.infer<typeof quoteDecline>) {
  const b = await byToken(token);
  if (b.lots.every((l) => l.contract.status === 'accepted')) throw new HttpError(409, 'This quote is already accepted. Call the company to change it.', 'already_accepted');
  // Every lot still waiting on this link is declined together (issue 101).
  const open = b.lots.filter((l) => l.contract.status === 'draft' || l.contract.status === 'sent');
  if (!open.length) return { already: true };
  const took = await serviceDb().update(contract).set({ status: 'declined', declined_at: new Date().toISOString(), decline_reason: input.reason || null })
    .where(and(inArray(contract.id, open.map((l) => l.contract.id)), eq(contract.tenant_id, b.tenant.id), inArray(contract.status, ['draft', 'sent']))).returning({ id: contract.id });
  if (!took.length) return { already: true };
  const gone = open.filter((l) => took.some((x) => x.id === l.contract.id));
  const r = gone[0]!;
  await notifyOffice(r.tenant, {
    // A short subject of Flake's own; the customer's note, as plain text, only in the body (issue 70).
    subject: `${r.customer.name} declined a quote`,
    headline: `${r.customer.name} declined the ${r.contract.season} quote for ${gone.map((l) => l.site.label).join(', ')}.${input.reason ? ` Their note: "${plainText(input.reason)}"` : ''}`,
    link: `${baseUrl()}/sites/${r.site.id}`,
    key: `quote_declined:${r.contract.id}`,
    related: { site_id: r.site.id },
  });
  return { already: false };
}

/**
 * A quote's link is stored only as a hash, so it can't be shown again. Resending makes a new link, sends it, and the
 * old one stops working. A signed contract isn't resent; its PDF is on the site page.
 */
export async function resendQuote(ctx: Ctx, contractId: string) {
  const token = newToken();
  const row = await withUser(ctx.userId, async (tx) => {
    const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
    if (!c) throw new HttpError(404, 'Contract not found');
    if (!['draft', 'sent'].includes(c.status)) throw new HttpError(409, c.status === 'accepted' ? 'This contract is already signed.' : c.status === 'declined' ? 'The customer declined this quote. Send a new one.' : 'This quote is void. Send a new one.', 'not_resendable');
    const [st] = await tx.select().from(site).where(eq(site.id, c.site_id));
    if (!st?.active) throw new HttpError(409, 'This site is retired. Restore it to quote it.', 'site_retired');
    const [cust] = await tx.select().from(customer).where(eq(customer.id, st.customer_id));
    const [t] = await tx.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
    // The other lots on the same link move to the new one with it (issue 101), so the customer still signs once.
    const same = c.quote_token_hash ? or(eq(contract.id, c.id), eq(contract.quote_token_hash, c.quote_token_hash)) : eq(contract.id, c.id);
    await asService(tx, ctx.tenantId, () => tx.update(contract).set({ status: 'sent', quote_token_hash: hashToken(token), quote_token_enc: encryptToken(token) }).where(and(same, eq(contract.tenant_id, ctx.tenantId), inArray(contract.status, ['draft', 'sent']))));
    return { contract: c, customer: cust!, tenant: t! };
  });
  const link = await shortLink(ctx.tenantId, `/q/${token}`);
  await queueNotify(row.tenant.id, { phone: row.customer.phone_e164, email: row.customer.email }, { template: 'quote', vars: { link }, subject: `${row.tenant.name}: your snow service quote`, key: `quote:${row.contract.id}:${hashToken(token).slice(0, 12)}`, related: { contract_id: row.contract.id } });
  return { url: `${baseUrl()}/q/${token}` };
}

/** The link to a quote still waiting for a signature, when it was made after links were kept. */
export function quoteUrl(c: { status: string; quote_token_enc: string | null }) {
  return c.status === 'sent' && c.quote_token_enc ? `${baseUrl()}/q/${decryptToken(c.quote_token_enc)}` : null;
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
