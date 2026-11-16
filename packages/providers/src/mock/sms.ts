import { createHmac, randomUUID } from 'node:crypto';
import type { SmsProvider, SmsSend, TollFreePayload } from '../types';

export const MOCK_TWILIO_TOKEN = 'mock-twilio-token';
/** A number the mock refuses the way Twilio refuses a landline or a bad number (error 21614), for testing. */
export const MOCK_REJECTED_PHONE = '+12165550000';

/** Twilio's documented scheme: HMAC-SHA1 of the URL plus sorted params, base64. */
export function signTwilio(token: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', token).update(data).digest('base64');
}

/** The app logs every message to message_log, which is what /dev/inbox shows. Nothing leaves the machine. */
export class MockSms implements SmsProvider {
  async send(msg: SmsSend) {
    if (msg.to === MOCK_REJECTED_PHONE) throw Object.assign(new Error("Mock 400: 'To' number is not a valid mobile number"), { rejected: true });
    return { id: `SM_mock_${randomUUID()}`, status: 'sent' };
  }
  async provisionTenant(friendlyName: string) {
    const n = [...friendlyName].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 10000, 7);
    return { subaccountSid: `AC_mock_${n}`, sender: `+1833555${String(n).padStart(4, '0').slice(0, 4)}` };
  }
  async submitTollFreeVerification(_sid: string, _sender: string, _payload: TollFreePayload) {
    return { id: `HH_mock_${randomUUID()}`, status: 'pending' as const };
  }
  verifyWebhook(url: string, params: Record<string, string>, signature: string | null) {
    return signature === signTwilio(MOCK_TWILIO_TOKEN, url, params);
  }
}
