import { eq, message_log, serviceDb } from '@flake/db';
import { baseUrl } from '@/lib/env';
import { getProviders } from '@/lib/providers';

export async function POST(req: Request) {
  const params = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const { sms } = await getProviders();
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl()}/api/webhooks/twilio/status`;
  if (!sms.verifyWebhook(url, params, req.headers.get('x-twilio-signature'))) return new Response('Forbidden', { status: 403 });
  if (params.MessageSid && params.MessageStatus) await serviceDb().update(message_log).set({ status: params.MessageStatus }).where(eq(message_log.provider_id, params.MessageSid));
  return new Response(null, { status: 204 });
}
