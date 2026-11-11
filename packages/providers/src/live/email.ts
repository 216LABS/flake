import type { EmailProvider, EmailSend } from '../types';

/** A company name can hold anything. Commas and brackets would make the From header invalid, so only plain words go in it. */
export const senderName = (name: string) => name.replace(/[^\p{L}\p{N}&' .-]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Just the address, however EMAIL_FROM was written: bare, quoted, padded, or already `Name <address>`. */
export const senderAddress = (from: string) => (/<([^<>]+)>/.exec(from)?.[1] ?? from).trim().replace(/^["']|["']$/g, '').trim();

/** Resend over fetch. The tenant is the display name and the reply-to; the address is Flake's verified subdomain. */
export class LiveEmail implements EmailProvider {
  private from: string;
  constructor(private key: string, from: string, private fetchImpl: typeof fetch = fetch) {
    this.from = senderAddress(from);
  }

  async send(msg: EmailSend) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': msg.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({
        from: senderName(msg.fromName) ? `${senderName(msg.fromName)} <${this.from}>` : this.from,
        to: [msg.to],
        reply_to: msg.replyTo ?? undefined,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    });
    const body = (await res.json()) as { id?: string; message?: string; name?: string };
    if (res.status === 429) {
      // A daily quota won't clear in seconds, so it waits longer than a burst does.
      const seconds = Number(res.headers.get('retry-after')) || (/quota/i.test(`${body.name} ${body.message}`) ? 3600 : 5);
      throw Object.assign(new Error(`Resend 429: ${body.message ?? 'rate limited'}`), { retryAfterSeconds: seconds });
    }
    // 400 and 422 are about this message: a bad or blocked address won't send on any retry (issue 49). Other errors
    // (an outage, a bad key) can clear, so they retry.
    if (res.status === 400 || res.status === 422) throw Object.assign(new Error(`Resend ${res.status}: ${body.message ?? 'rejected'}`), { rejected: true });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? 'request failed'}`);
    return { id: body.id ?? 'unknown', status: 'sent' };
  }
}
