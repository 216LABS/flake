import { timingSafeEqual } from 'node:crypto';
import { signTwilio } from '../mock/sms';

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
import type { SmsProvider, SmsSend, TollFreePayload } from '../types';

/** Twilio REST over fetch, one subaccount per tenant (ADDENDUM_SMS section 1). */
export class LiveSms implements SmsProvider {
  /** Subaccount auth tokens, looked up once each. A company's number belongs to its subaccount. */
  private subTokens = new Map<string, string | null>();
  constructor(private sid: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private auth(sid = this.sid, token = this.token) {
    return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  }

  private async post(url: string, params: Record<string, string>, auth = this.auth()) {
    const res = await this.fetchImpl(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const body = (await res.json()) as any;
    // Not a valid number, not a mobile, or the person texted STOP: no retry will reach them (issue 49).
    if (!res.ok && [21211, 21214, 21217, 21401, 21407, 21408, 21610, 21612, 21614].includes(Number(body.code))) {
      throw Object.assign(new Error(`Twilio ${res.status}: ${body.message ?? 'rejected'}`), { rejected: true });
    }
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? 'request failed'}`);
    return body;
  }

  async send(msg: SmsSend) {
    if (!msg.subaccountSid) throw new Error('Tenant has no Twilio subaccount');
    const params: Record<string, string> = { To: msg.to, From: msg.from, Body: msg.body };
    if (msg.statusCallback) params.StatusCallback = msg.statusCallback;
    const body = await this.post(`https://api.twilio.com/2010-04-01/Accounts/${msg.subaccountSid}/Messages.json`, params);
    return { id: body.sid as string, status: body.status as string };
  }

  async provisionTenant(friendlyName: string, webhookBase: string) {
    const sub = await this.post('https://api.twilio.com/2010-04-01/Accounts.json', { FriendlyName: friendlyName.slice(0, 64) });
    const available = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sub.sid}/AvailablePhoneNumbers/US/TollFree.json?SmsEnabled=true&PageSize=1`, { headers: { Authorization: this.auth() } });
    const list = (await available.json()) as { available_phone_numbers?: { phone_number: string }[] };
    const number = list.available_phone_numbers?.[0]?.phone_number;
    if (!number) throw new Error('No toll-free numbers are available');
    await this.post(`https://api.twilio.com/2010-04-01/Accounts/${sub.sid}/IncomingPhoneNumbers.json`, {
      PhoneNumber: number,
      SmsUrl: `${webhookBase}/api/webhooks/twilio/inbound`,
      SmsMethod: 'POST',
      StatusCallback: `${webhookBase}/api/webhooks/twilio/status`,
    });
    return { subaccountSid: sub.sid as string, sender: number };
  }

  /** The number's PN... SID, which is what toll-free verification asks for, not the number itself. */
  private async numberSid(subaccountSid: string, number: string) {
    if (number.startsWith('PN')) return number;
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${subaccountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`, { headers: { Authorization: this.auth() } });
    const body = (await res.json()) as { incoming_phone_numbers?: { sid: string }[]; message?: string };
    const sid = body.incoming_phone_numbers?.[0]?.sid;
    if (!res.ok || !sid) throw new Error(`Twilio ${res.status}: could not find ${number} on this company's account`);
    return sid;
  }

  /** [T] Field names follow Twilio's Toll-Free Verification API; confirm against current docs at go-live. */
  async submitTollFreeVerification(subaccountSid: string, sender: string, p: TollFreePayload, webhookBase: string) {
    const numberSid = await this.numberSid(subaccountSid, sender);
    const body = await this.post('https://messaging.twilio.com/v1/Tollfree/Verifications', {
      BusinessName: p.legal_name,
      BusinessRegistrationNumber: p.ein,
      BusinessRegistrationAuthority: 'EIN',
      BusinessWebsite: p.website,
      BusinessStreetAddress: p.address.line1,
      BusinessCity: p.address.city,
      BusinessStateProvinceRegion: p.address.state,
      BusinessPostalCode: p.address.zip,
      BusinessCountry: 'US',
      BusinessContactFirstName: p.contact_name.split(' ')[0] ?? p.contact_name,
      BusinessContactLastName: p.contact_name.split(' ').slice(1).join(' ') || '-',
      BusinessContactEmail: p.contact_email,
      BusinessContactPhone: p.contact_phone,
      NotificationEmail: p.contact_email,
      UseCaseCategories: 'ACCOUNT_NOTIFICATIONS',
      UseCaseSummary: p.use_case,
      ProductionMessageSample: p.sample_messages.join(' | ').slice(0, 1024),
      OptInImageUrls: p.opt_in_screenshot_url,
      OptInType: 'WEB_FORM',
      MessageVolume: String(p.expected_monthly_volume),
      TollfreePhoneNumberSid: numberSid,
      ExternalReferenceId: webhookBase,
    });
    return { id: body.sid as string, status: 'pending' as const };
  }

  /**
   * Twilio signs with the auth token of the account that owns the number. Each company's number lives on its own
   * subaccount, so its STOP replies and delivery reports carry that subaccount's signature, not the main one.
   */
  async verifyWebhook(url: string, params: Record<string, string>, signature: string | null) {
    if (!signature) return false;
    if (safeEqual(signature, signTwilio(this.token, url, params))) return true;
    const sub = params.AccountSid;
    if (!sub || sub === this.sid || !/^AC[0-9a-f]{32}$/.test(sub)) return false;
    if (!this.subTokens.has(sub)) {
      // Only subaccounts of this main account answer to its credentials, so a made-up AccountSid finds nothing.
      const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sub}.json`, { headers: { Authorization: this.auth() } });
      const body = res.ok ? ((await res.json()) as { auth_token?: string; owner_account_sid?: string }) : null;
      this.subTokens.set(sub, body?.auth_token && (!body.owner_account_sid || body.owner_account_sid === this.sid) ? body.auth_token : null);
    }
    const token = this.subTokens.get(sub);
    return Boolean(token && safeEqual(signature, signTwilio(token, url, params)));
  }

  async tollFreeStatus(verificationId: string) {
    const res = await this.fetchImpl(`https://messaging.twilio.com/v1/Tollfree/Verifications/${encodeURIComponent(verificationId)}`, { headers: { Authorization: this.auth() } });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; rejection_reason?: string | null };
    if (body.status === 'TWILIO_APPROVED') return { status: 'approved' as const, reason: null };
    if (body.status === 'TWILIO_REJECTED') return { status: 'rejected' as const, reason: body.rejection_reason ?? 'Rejected by Twilio' };
    return { status: 'pending' as const, reason: null };
  }
}
