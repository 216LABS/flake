import { and, customer, eq, serviceDb } from '@flake/db';
import { z } from 'zod';
import { requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { qboAuth, retryQboWaiting } from '@/lib/qbo';

const body = z.object({
  matches: z.array(z.object({
    customer_id: z.uuid(),
    /** A QuickBooks customer id, 'new' to create one there, or null to clear the match. */
    qbo: z.union([z.string().min(1).max(40), z.null()]),
  })).min(1).max(500),
});

/** The owner confirms each match, or has the customer made in QuickBooks. Bills waiting on a match then go. */
export const POST = route(async (req) => {
  const ctx = await requireApi('owner');
  const { matches } = await parseJson(req, body);
  const auth = await qboAuth(ctx.tenantId);
  if (!auth) throw new HttpError(409, 'QuickBooks is not connected.', 'not_connected');
  const { accounting } = await getProviders();
  const db = serviceDb();
  const known = new Set((await accounting.listCustomers(auth)).map((c) => c.id));
  let made = 0;
  for (const m of matches) {
    const [c] = await db.select().from(customer).where(and(eq(customer.id, m.customer_id), eq(customer.tenant_id, ctx.tenantId)));
    if (!c) throw new HttpError(404, 'Customer not found');
    let id = m.qbo;
    if (id === 'new') {
      id = (await accounting.createCustomer(auth, { name: c.name, email: c.email })).id;
      made++;
    } else if (id && !known.has(id)) {
      throw new HttpError(400, `That QuickBooks customer for ${c.name} is gone. Reload and pick again.`);
    }
    await db.update(customer).set({ qbo_customer_id: id }).where(eq(customer.id, c.id));
  }
  const retried = await retryQboWaiting(ctx.tenantId);
  return { ok: true, created: made, retried };
});
