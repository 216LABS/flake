import { baseUrl } from '@/lib/env';
import { getProviders } from '@/lib/providers';
import { setTollFreeStatus } from '@/lib/sms-admin';

/** SMS turns on when Twilio reports TWILIO_APPROVED. Rejection reasons surface in settings. */
export async function POST(req: Request) {
  const raw = await req.text();
  const contentJson = (req.headers.get('content-type') ?? '').includes('json');
  const params: Record<string, string> = contentJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  const { sms } = await getProviders();
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl()}/api/webhooks/twilio/tollfree`;
  if (!sms.verifyWebhook(url, contentJson ? {} : params, req.headers.get('x-twilio-signature'))) return new Response('Forbidden', { status: 403 });
  const id = params.VerificationSid ?? params.sid;
  const status = params.Status ?? params.status;
  if (id && status === 'TWILIO_APPROVED') await setTollFreeStatus({ verificationId: id }, 'approved', null);
  if (id && status === 'TWILIO_REJECTED') await setTollFreeStatus({ verificationId: id }, 'rejected', params.RejectionReason ?? params.rejection_reason ?? 'Rejected by Twilio');
  return new Response(null, { status: 204 });
}
