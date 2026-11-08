import { customer, eq } from '@flake/db';
import { z } from 'zod';
import { asUser, requireApi } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { queueNotify } from '@/lib/messaging';
import { portalToken, resetPortalToken } from '@/lib/portal';

type Ctx = { params: Promise<{ id: string }> };

/** RLS decides whether this person can see the customer at all. */
async function load(id: string, minRole: 'viewer' | 'dispatcher') {
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi(minRole);
  const [c] = await asUser(ctx, (tx) => tx.select().from(customer).where(eq(customer.id, id)));
  if (!c) throw new HttpError(404, 'Not found');
  return { ctx, c };
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const { c } = await load((await params).id, 'dispatcher');
  return { url: `${baseUrl()}/c/${await portalToken(c.id)}` };
});

const body = z.object({ action: z.enum(['email', 'reset']) });

/** Email sends the current link. Reset turns off every earlier link, for a lost or forwarded one. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { ctx, c } = await load((await params).id, 'dispatcher');
  const { action } = await parseJson(req, body);
  if (action === 'reset') return { url: `${baseUrl()}/c/${await resetPortalToken(c.id)}` };
  if (!c.email) throw new HttpError(422, 'Add an email for this customer first.');
  const url = `${baseUrl()}/c/${await portalToken(c.id)}`;
  await queueNotify(ctx.tenantId, { email: c.email }, { template: 'portal', vars: { link: url }, subject: `${ctx.tenant.name}: your snow service records`, key: `portal:${c.id}:${Date.now()}`, related: { customer_id: c.id } });
  return { url, sent_to: c.email };
});
