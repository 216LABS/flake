import { and, crew_member, eq, serviceDb, sms_consent, sql, tenant } from '@flake/db';
import { classifyInbound, renderTemplate } from '@flake/core/messages';
import { baseUrl, isMock } from './env';
import { HttpError } from './http';
import { enqueue } from './jobs';
import { getProviders } from './providers';
import { encryptToken } from './tokens';

export const SAMPLE_MESSAGES = (company: string) => [
  renderTemplate('crew_link', { company, route: 'West', n: 12, link: `${baseUrl()}/s/abc123` }),
  renderTemplate('on_the_way', { company, site: 'Main St Lot' }),
  renderTemplate('done', { company, site: 'Main St Lot', time: '5:10 AM', link: `${baseUrl()}/s/abc123` }),
];

/** Checks everything toll-free verification requires, then queues the submission. */
export async function requestTollFree(tenantId: string, ein: string | undefined) {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  if (!t) throw new HttpError(404, 'Tenant not found');
  const v = (t.sms_verification ?? {}) as Record<string, any>;
  const missing = [
    !t.business_legal_name && 'legal business name',
    !ein && 'EIN',
    !t.address && 'business address',
    !t.contact_email && 'contact email',
    !t.contact_phone && 'contact phone',
    !v.contact_name && 'contact name',
  ].filter(Boolean);
  if (missing.length) throw new HttpError(422, `Add these first: ${missing.join(', ')}`, 'incomplete');
  await db.update(tenant).set({ sms_status: 'pending', sms_status_detail: null, ein_last4: ein!.replace(/\D/g, '').slice(-4) }).where(eq(tenant.id, tenantId));
  // The tenant row keeps only the last 4. The full EIN sits encrypted in the job payload for the submission.
  await enqueue('sms.tollfree_submit', { tenantId, ein: encryptToken(ein!) }, { dedupeKey: `tollfree:${tenantId}:${Date.now()}` });
}

/** sms.tollfree_submit: subaccount, toll-free number, verification, all in the tenant's own legal name. */
export async function submitTollFree(tenantId: string, ein: string) {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  if (!t) return;
  try {
    await submitToTwilio(t, ein);
  } catch (err) {
    // Keep the owner informed. The job retries, and a later success sets the status back to pending.
    await db.update(tenant).set({ sms_status: 'rejected', sms_status_detail: 'We could not submit this to Twilio yet. We will keep trying.' }).where(eq(tenant.id, tenantId));
    throw err;
  }
}

async function submitToTwilio(t: typeof tenant.$inferSelect, ein: string) {
  const db = serviceDb();
  const tenantId = t.id;
  const { sms } = await getProviders();
  const base = process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl();
  let sid = t.twilio_subaccount_sid;
  let sender = t.sms_sender;
  if (!sid || !sender) {
    const created = await sms.provisionTenant(t.name, base);
    sid = created.subaccountSid;
    sender = created.sender;
    await db.update(tenant).set({ twilio_subaccount_sid: sid, sms_sender: sender }).where(eq(tenant.id, tenantId));
  }
  const v = (t.sms_verification ?? {}) as Record<string, any>;
  const res = await sms.submitTollFreeVerification(sid, sender, {
    legal_name: t.business_legal_name!,
    ein,
    address: t.address as { line1: string; city: string; state: string; zip: string },
    website: v.website ?? `${baseUrl()}/b/${t.slug}`,
    contact_name: v.contact_name,
    contact_email: t.contact_email!,
    contact_phone: t.contact_phone!,
    use_case: 'Account notifications and customer care for a snow removal company: route links to opted-in crew and service updates to opted-in customers.',
    expected_monthly_volume: v.expected_monthly_volume ?? 1000,
    opt_in_description: `Crew opt in on the invite page. Customers opt in with an unchecked box on the quote page. See ${baseUrl()}/b/${t.slug}/sms`,
    opt_in_screenshot_url: `${baseUrl()}/b/${t.slug}/sms`,
    sample_messages: SAMPLE_MESSAGES(t.name),
  }, base);
  await db.update(tenant).set({ sms_status: res.status, sms_status_detail: null, sms_verification: { ...v, twilio_verification_id: res.id, submitted_at: new Date().toISOString() } }).where(eq(tenant.id, tenantId));
  // Twilio reports the result by webhook. Mock mode auto-approves after 10 s (ADDENDUM_SMS section 7).
  if (isMock()) await enqueue('sms.mock_approve', { tenantId }, { dedupeKey: `mock_approve:${tenantId}:${res.id}`, runAt: new Date(Date.now() + 10000) });
}

export async function setTollFreeStatus(where: { tenantId?: string; verificationId?: string }, status: 'approved' | 'rejected', detail: string | null) {
  const db = serviceDb();
  const cond = where.tenantId ? eq(tenant.id, where.tenantId) : sql`${tenant.sms_verification}->>'twilio_verification_id' = ${where.verificationId!}`;
  await db.update(tenant).set({ sms_status: status, sms_status_detail: detail }).where(cond);
}

/** STOP, START, HELP and call-out replies. Twilio Advanced Opt-Out sends the actual reply; this mirrors it. */
export async function handleInboundSms(to: string, from: string, body: string): Promise<{ kind: string; reply: string | null }> {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.sms_sender, to));
  if (!t) return { kind: 'unknown_sender', reply: null };
  const [consent] = await db.select().from(sms_consent).where(and(eq(sms_consent.tenant_id, t.id), eq(sms_consent.phone_e164, from)));
  const kind = classifyInbound(body, Boolean(consent?.opted_out_at));
  const now = new Date().toISOString();
  if (kind === 'stop') {
    await db.insert(sms_consent).values({ tenant_id: t.id, phone_e164: from, opted_out_at: now }).onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_out_at: now } });
  } else if (kind === 'start') {
    await db.insert(sms_consent).values({ tenant_id: t.id, phone_e164: from, opted_in_at: now, opted_in_source: 'sms_start' }).onConflictDoUpdate({ target: [sms_consent.tenant_id, sms_consent.phone_e164], set: { opted_out_at: null, opted_in_at: now, opted_in_source: 'sms_start' } });
  } else if (kind === 'yes' || kind === 'no') {
    await db.update(crew_member).set({ callout_reply: kind.toUpperCase(), callout_reply_at: now }).where(and(eq(crew_member.tenant_id, t.id), eq(crew_member.phone_e164, from)));
  }
  const reply = kind === 'help' ? renderTemplate('help', { company: t.name, phone: t.contact_phone ?? 'your dispatcher' }) : null;
  return { kind, reply };
}
