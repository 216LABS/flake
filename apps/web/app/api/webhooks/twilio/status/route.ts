import { and, eq, message_log, serviceDb, sql } from '@flake/db';
import { baseUrl } from '@/lib/env';
import { getProviders } from '@/lib/providers';

export async function POST(req: Request) {
  const params = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const { sms } = await getProviders();
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL ?? baseUrl()}/api/webhooks/twilio/status`;
  if (!sms.verifyWebhook(url, params, req.headers.get('x-twilio-signature'))) return new Response('Forbidden', { status: 403 });
  if (params.MessageSid && params.MessageStatus) {
    // Twilio's callbacks can arrive out of order. A late "sent" must not overwrite "delivered" or "failed".
    const rank = (col: unknown) => sql`(case ${col} when 'accepted' then 1 when 'queued' then 1 when 'sending' then 2 when 'sent' then 3 when 'delivered' then 4 when 'undelivered' then 4 when 'failed' then 4 when 'read' then 5 else 0 end)`;
    await serviceDb().update(message_log).set({ status: params.MessageStatus })
      .where(and(eq(message_log.provider_id, params.MessageSid), sql`${rank(sql`${params.MessageStatus}::text`)} >= ${rank(message_log.status)}`));
  }
  return new Response(null, { status: 204 });
}
