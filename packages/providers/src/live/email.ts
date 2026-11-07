import type { EmailProvider, EmailSend } from '../types';

/** Resend over fetch. The tenant is the display name and the reply-to; the address is Flake's verified subdomain. */
export class LiveEmail implements EmailProvider {
  constructor(private key: string, private from: string, private fetchImpl: typeof fetch = fetch) {}

  async send(msg: EmailSend) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': msg.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({
        from: `${msg.fromName.replace(/[<>"]/g, '')} <${this.from}>`,
        to: [msg.to],
        reply_to: msg.replyTo ?? undefined,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    });
    const body = (await res.json()) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? 'request failed'}`);
    return { id: body.id ?? 'unknown', status: 'sent' };
  }
}
