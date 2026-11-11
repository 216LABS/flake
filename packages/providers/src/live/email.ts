import type { EmailProvider, EmailSend } from '../types';

/**
 * The company's name as typed, apostrophes and brackets included. Only line breaks and control characters, which could
 * add a header, are taken out; the From line quotes it, so commas and parentheses are safe.
 */
export const senderName = (name: string) => name.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);

/**
 * `Flip's Plowing <flake@...>` when the name is plain words, and `"Flip's Plowing (Demo)" <flake@...>`, quoted with quotes
 * and backslashes escaped, when it has commas, brackets or the like. Either way the name reads as the company typed it.
 */
export const fromHeader = (name: string, address: string) => {
  const n = senderName(name);
  if (!n) return address;
  return /^[\p{L}\p{N}\p{M} !#$%&'*+/=?^_`{|}~.’-]+$/u.test(n) ? `${n} <${address}>` : `"${n.replace(/["\\]/g, '\\$&')}" <${address}>`;
};

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
        from: fromHeader(msg.fromName, this.from),
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
