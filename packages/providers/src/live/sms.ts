import { signTwilio } from '../mock/sms';
import type { SmsProvider, SmsSend, TollFreePayload } from '../types';

/** Twilio REST over fetch, one subaccount per tenant (ADDENDUM_SMS section 1). */
export class LiveSms implements SmsProvider {
  constructor(private sid: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private auth(sid = this.sid, token = this.token) {
    return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  }

  private async post(url: string, params: Record<string, string>, auth = this.auth()) {
    const res = await this.fetchImpl(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const body = (await res.json()) as any;
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

  /** [T] Field names follow Twilio's Toll-Free Verification API; confirm against current docs at go-live. */
  async submitTollFreeVerification(_subaccountSid: string, sender: string, p: TollFreePayload, webhookBase: string) {
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
      TollfreePhoneNumberSid: sender,
      ExternalReferenceId: webhookBase,
    });
    return { id: body.sid as string, status: 'pending' as const };
  }

  verifyWebhook(url: string, params: Record<string, string>, signature: string | null) {
    return signature === signTwilio(this.token, url, params);
  }
}
