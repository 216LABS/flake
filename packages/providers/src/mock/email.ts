import type { EmailProvider, EmailSend } from '../types';

/** Addresses at this test domain are refused the way Resend refuses an invalid recipient, so that path can be tested. */
export const MOCK_REJECTED_DOMAIN = 'rejected.example.com';

export class MockEmail implements EmailProvider {
  async send(msg: EmailSend) {
    if (msg.to.toLowerCase().endsWith(`@${MOCK_REJECTED_DOMAIN}`)) throw Object.assign(new Error('Mock 422: invalid `to` address'), { rejected: true });
    return { id: `em_mock_${msg.idempotencyKey.slice(0, 40)}`, status: 'sent' };
  }
}
