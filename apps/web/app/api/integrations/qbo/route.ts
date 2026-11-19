import { and, customer, eq, integration, qbo_item_map, serviceDb } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { qboOverview } from '@/lib/qbo';
import { decryptToken } from '@/lib/tokens';

/** Connection, matches, items and sync problems. Office staff can look; tokens never leave the server. */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return qboOverview(ctx.tenantId);
});

/**
 * Disconnect: revokes the app at Intuit and forgets the tokens, matches and item choices. Bills already in QuickBooks
 * stay there. Nothing syncs until it is connected again.
 */
export const DELETE = route(async () => {
  const ctx = await requireApi('owner');
  const db = serviceDb();
  const [row] = await db.select().from(integration).where(and(eq(integration.tenant_id, ctx.tenantId), eq(integration.provider, 'qbo')));
  if (row?.refresh_enc) {
    const { accounting } = await getProviders();
    await accounting.revoke(decryptToken(row.refresh_enc)).catch(() => undefined);
  }
  await db.update(integration).set({ status: 'disconnected', status_detail: null, token_enc: null, refresh_enc: null, expires_at: null, updated_at: new Date().toISOString() }).where(and(eq(integration.tenant_id, ctx.tenantId), eq(integration.provider, 'qbo')));
  await db.update(customer).set({ qbo_customer_id: null }).where(eq(customer.tenant_id, ctx.tenantId));
  await db.delete(qbo_item_map).where(eq(qbo_item_map.tenant_id, ctx.tenantId));
  return { ok: true };
});
