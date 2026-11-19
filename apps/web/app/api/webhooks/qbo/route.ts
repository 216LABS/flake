import { eq, integration, serviceDb } from '@flake/db';
import { HttpError, route } from '@/lib/http';
import { enqueue } from '@/lib/jobs';
import { getProviders } from '@/lib/providers';

/**
 * Intuit says something changed in a connected company. Only the signature is trusted, and only the realm is read: a
 * payment check runs for that company, which asks QuickBooks itself what is paid.
 */
export const POST = route(async (req) => {
  const raw = await req.text();
  const { accounting } = await getProviders();
  if (!accounting.verifyWebhook(raw, req.headers.get('intuit-signature'))) throw new HttpError(401, 'Invalid signature');
  let realms: string[];
  try {
    const body = JSON.parse(raw) as { eventNotifications?: { realmId?: string }[] };
    realms = [...new Set((body.eventNotifications ?? []).map((e) => e.realmId).filter((r): r is string => Boolean(r)))].slice(0, 50);
  } catch {
    throw new HttpError(400, 'Bad body');
  }
  const minute = new Date().toISOString().slice(0, 16);
  for (const realm of realms) {
    const rows = await serviceDb().select({ tenant_id: integration.tenant_id }).from(integration).where(eq(integration.realm_id, realm));
    for (const r of rows) await enqueue('qbo.poll', { tenantId: r.tenant_id }, { dedupeKey: `qbo:poll:${r.tenant_id}:${minute}` });
  }
  return { received: true };
});
