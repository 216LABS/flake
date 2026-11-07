import type { EmailProvider, EmailSend } from '../types';

export class MockEmail implements EmailProvider {
  async send(msg: EmailSend) {
    return { id: `em_mock_${msg.idempotencyKey.slice(0, 40)}`, status: 'sent' };
  }
}
