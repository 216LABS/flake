import { QBO_KEYS } from '@flake/core/qbo';
import { and, eq, qbo_item_map, serviceDb } from '@flake/db';
import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { qboAuth, retryQboWaiting } from '@/lib/qbo';

const body = z.object({ map: z.partialRecord(z.enum(QBO_KEYS), z.union([z.string().min(1).max(40), z.null()])) });

/** Which QuickBooks item plowing, salt, walks, hauling, installments and anything else post to. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { map } = await parseJson(req, body);
  const auth = await qboAuth(ctx.tenantId);
  if (!auth) throw new HttpError(409, 'QuickBooks is not connected.', 'not_connected');
  const { accounting } = await getProviders();
  const items = new Map((await accounting.listItems(auth)).map((i) => [i.id, i.name]));
  const db = serviceDb();
  for (const [key, id] of Object.entries(map) as [(typeof QBO_KEYS)[number], string | null][]) {
    if (!id) {
      await db.delete(qbo_item_map).where(and(eq(qbo_item_map.tenant_id, ctx.tenantId), eq(qbo_item_map.flake_key, key)));
      continue;
    }
    if (!items.has(id)) throw new HttpError(400, 'That QuickBooks item is gone. Reload and pick again.');
    const v = { qbo_item_id: id, qbo_item_name: items.get(id)! };
    await db.insert(qbo_item_map).values({ tenant_id: ctx.tenantId, flake_key: key, ...v }).onConflictDoUpdate({ target: [qbo_item_map.tenant_id, qbo_item_map.flake_key], set: v });
  }
  return { ok: true, retried: await retryQboWaiting(ctx.tenantId) };
});
