import { createHash } from 'node:crypto';
import { baseUrl } from '@/lib/env';
import { getProviders } from '@/lib/providers';
import { setTollFreeStatus } from '@/lib/sms-admin';

/** SMS turns on when Twilio reports TWILIO_APPROVED. Rejection reasons surface in settings. */
export async function POST(req: Request) {
  const raw = await req.text();
  const contentJson = (req.headers.get('content-type') ?? '').includes('json');
  let params: Record<string, string>;
  try {
    params = contentJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const { sms } = await getProviders();
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl()}/api/webhooks/twilio/tollfree`;
  // Twilio signs a JSON body by putting its hash in the URL it signs, so the hash must match the body we got.
  const bodyHash = new URL(req.url).searchParams.get('bodySHA256');
  if (contentJson && (!bodyHash || bodyHash !== createHash('sha256').update(raw).digest('hex'))) return new Response('Forbidden', { status: 403 });
  const signedUrl = contentJson ? `${url}?bodySHA256=${bodyHash}` : url;
  if (!(await sms.verifyWebhook(signedUrl, contentJson ? {} : params, req.headers.get('x-twilio-signature')))) return new Response('Forbidden', { status: 403 });
  const id = params.VerificationSid ?? params.sid;
  const status = params.Status ?? params.status;
  if (id && status === 'TWILIO_APPROVED') await setTollFreeStatus({ verificationId: id }, 'approved', null);
  if (id && status === 'TWILIO_REJECTED') await setTollFreeStatus({ verificationId: id }, 'rejected', params.RejectionReason ?? params.rejection_reason ?? 'Rejected by Twilio');
  return new Response(null, { status: 204 });
}
