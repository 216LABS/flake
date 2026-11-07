import { and, eq, serviceDb, short_link, sms_consent, sql, tenant } from '@flake/db';
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
async function reserve(t: TenantRow, channel: 'sms' | 'email', to: string, template: string, body: string, key: string, related: Record<string, unknown> | null) {
  const rows = (await serviceDb().execute(sql`
    insert into message_log (tenant_id, channel, to_addr, template, body, related, status, idempotency_key)
    values (${t.id}, ${channel}, ${to}, ${template}, ${body}, ${related ? JSON.stringify(related) : null}::jsonb, 'sending', ${key})
    on conflict (tenant_id, idempotency_key) do update set status = 'sending'
      where message_log.status = 'failed'
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
