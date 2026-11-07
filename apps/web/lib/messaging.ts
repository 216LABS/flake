import { and, eq, inArray, membership, push_subscription, serviceDb, short_link, sms_consent, sql, tenant } from '@flake/db';
import { inInvoiceHours, renderTemplate, type TemplateKey } from '@flake/core/messages';
import { localHm, nextInvoiceWindow } from '@flake/core/time';
import { baseUrl } from './env';
import { enqueue } from './jobs';
import { getProviders } from './providers';
import { shortCode } from './tokens';

type TenantRow = typeof tenant.$inferSelect;

export async function shortLink(tenantId: string, target: string): Promise<string> {
  const code = shortCode();
  await serviceDb().insert(short_link).values({ code, tenant_id: tenantId, target });
  return `${baseUrl()}/s/${code}`;
}

/** Never text anyone without an opted-in consent row that hasn't been revoked. */
export async function hasSmsConsent(tenantId: string, phone: string): Promise<boolean> {
  const [row] = await serviceDb().select().from(sms_consent).where(and(eq(sms_consent.tenant_id, tenantId), eq(sms_consent.phone_e164, phone)));
  return Boolean(row?.opted_in_at) && !row?.opted_out_at;
}

/** SMS comes only from the tenant's own verified toll-free number. There is no shared Flake sender. */
export const canTextFrom = (t: TenantRow) => t.sms_status === 'approved' && Boolean(t.sms_sender);

/**
 * Reserves the idempotency key first. A second caller with the same key sends nothing; a previous failure
 * may be retried. Returns the row id when this caller should send.
 */
async function reserve(t: TenantRow, channel: 'sms' | 'email' | 'push', to: string, template: string, body: string, key: string, related: Record<string, unknown> | null) {
  const rows = (await serviceDb().execute(sql`
    insert into message_log (tenant_id, channel, to_addr, template, body, related, status, idempotency_key)
    values (${t.id}, ${channel}, ${to}, ${template}, ${body}, ${related ? JSON.stringify(related) : null}::jsonb, 'sending', ${key})
    on conflict (tenant_id, idempotency_key) do update set status = 'sending'
      where message_log.status = 'failed' or (message_log.status = 'sending' and message_log.created_at < now() - interval '5 minutes')
    returning id`)) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

async function finish(id: string, status: string, providerId: string | null) {
  await serviceDb().execute(sql`update message_log set status = ${status}, provider_id = ${providerId} where id = ${id}`);
}

export async function sendSms(t: TenantRow, opts: { to: string; template: TemplateKey; vars: Record<string, string | number>; key: string; related?: Record<string, unknown> }): Promise<boolean> {
  if (!canTextFrom(t) || !(await hasSmsConsent(t.id, opts.to))) return false;
  const body = renderTemplate(opts.template, opts.vars);
  const id = await reserve(t, 'sms', opts.to, opts.template, body, `sms:${opts.key}`, opts.related ?? null);
  if (!id) return false;
  try {
    const { sms } = await getProviders();
    const res = await sms.send({ from: t.sms_sender!, to: opts.to, body, subaccountSid: t.twilio_subaccount_sid, statusCallback: `${baseUrl()}/api/webhooks/twilio/status` });
    await finish(id, res.status, res.id);
    return true;
  } catch (err) {
    await finish(id, 'failed', null);
    throw err;
  }
}

export async function sendEmail(t: TenantRow, opts: { to: string; template: string; subject: string; text: string; key: string; related?: Record<string, unknown>; attachments?: { filename: string; content: Uint8Array }[] }): Promise<boolean> {
  const id = await reserve(t, 'email', opts.to, opts.template, opts.text, `email:${opts.key}`, opts.related ?? null);
  if (!id) return false;
  try {
    const { email } = await getProviders();
    const res = await email.send({ fromName: t.name, replyTo: t.contact_email, to: opts.to, subject: opts.subject, text: opts.text, idempotencyKey: opts.key, attachments: opts.attachments });
    await finish(id, res.status, res.id);
    return true;
  } catch (err) {
    await finish(id, 'failed', null);
    throw err;
  }
}

export interface PartyMessage {
  template: TemplateKey;
  vars: Record<string, string | number>;
  subject: string;
  key: string;
  related?: Record<string, unknown>;
}
export interface Party { phone?: string | null; email?: string | null; wantsSms?: boolean | null; wantsEmail?: boolean | null }

/**
 * The safe way to send from inside other work. A provider outage retries this job and can't fail the caller, and
 * the caller's own retry can't skip the message: its state has already moved on by the time the send would throw.
 */
export const queueNotify = (tenantId: string, party: Party, msg: PartyMessage) =>
  enqueue('notify.party', { tenantId, party, msg }, { dedupeKey: `party:${tenantId}:${msg.key}` });

export interface OfficePush {
  title: string;
  body: string;
  url: string;
  key: string;
  /** Only this person's devices, for the test button. Otherwise every owner and dispatcher. */
  userId?: string;
  related?: Record<string, unknown>;
}

export const queuePush = (tenantId: string, msg: OfficePush) => enqueue('notify.push', { tenantId, msg }, { dedupeKey: `push:${tenantId}:${msg.key}` });

/** Each device is logged and retried on its own, so one bad device can't repeat the alert on the others. */
export async function sendOfficePush(tenantId: string, msg: OfficePush) {
  const { push } = await getProviders();
  if (!push.publicKey) return;
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  if (!t) return;
  const staff = msg.userId ? [{ user_id: msg.userId }] : await db.select({ user_id: membership.user_id }).from(membership).where(and(eq(membership.tenant_id, tenantId), inArray(membership.role, ['owner', 'dispatcher'])));
  if (!staff.length) return;
  const subs = await db.select().from(push_subscription).where(and(eq(push_subscription.tenant_id, tenantId), inArray(push_subscription.user_id, staff.map((s) => s.user_id))));
  let failure: unknown = null;
  for (const sub of subs) {
    const id = await reserve(t, 'push', 'device', 'push', `${msg.title}: ${msg.body}`, `push:${msg.key}:${sub.id}`, msg.related ?? null);
    if (!id) continue;
    try {
      const res = await push.send(sub, { title: msg.title, body: msg.body, url: msg.url });
      await finish(id, res.status, null);
      if (res.status === 'gone') await db.delete(push_subscription).where(eq(push_subscription.id, sub.id));
    } catch (err) {
      await finish(id, 'failed', null);
      failure = err;
    }
  }
  if (failure) throw failure;
}

/** Sends over each channel the recipient can get. Email is the always-available fallback. */
export async function notifyParty(t: TenantRow, party: { phone?: string | null; email?: string | null; wantsSms?: boolean | null; wantsEmail?: boolean | null }, msg: {
  template: TemplateKey;
  vars: Record<string, string | number>;
  subject: string;
  key: string;
  related?: Record<string, unknown>;
  now?: Date;
}) {
  const vars = { company: t.name, ...msg.vars };
  const now = msg.now ?? new Date();
  const sent = { sms: false, email: false };
  if (party.phone && party.wantsSms !== false) {
    if (msg.template === 'invoice' && !inInvoiceHours(localHm(now, t.timezone).hm)) {
      // Invoice texts go out 8 AM to 8 PM local. Storm and service notices have no quiet hours.
      await enqueue('notify.invoice_sms', { tenantId: t.id, to: party.phone, vars, key: msg.key, related: msg.related }, { dedupeKey: `invoice_sms:${t.id}:${msg.key}`, runAt: nextInvoiceWindow(now, t.timezone) });
    } else {
      sent.sms = await sendSms(t, { to: party.phone, template: msg.template, vars, key: msg.key, related: msg.related });
    }
  }
  if (party.email && party.wantsEmail !== false) {
    sent.email = await sendEmail(t, { to: party.email, template: msg.template, subject: msg.subject, text: renderTemplate(msg.template, vars), key: msg.key, related: msg.related });
  }
  return sent;
}
