import { baseUrl } from '@/lib/env';
import { getProviders } from '@/lib/providers';
import { handleInboundSms } from '@/lib/sms-admin';

const xml = (body: string, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status, headers: { 'Content-Type': 'text/xml' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** STOP, START and HELP are mirrored into sms_consent; YES and NO show on the dashboard. */
export async function POST(req: Request) {
  const params = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const { sms } = await getProviders();
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl()}/api/webhooks/twilio/inbound`;
  if (!(await sms.verifyWebhook(url, params, req.headers.get('x-twilio-signature')))) return xml('', 403);
  const { reply } = await handleInboundSms(params.To ?? '', params.From ?? '', params.Body ?? '');
  return xml(reply ? `<Message>${esc(reply)}</Message>` : '');
}
