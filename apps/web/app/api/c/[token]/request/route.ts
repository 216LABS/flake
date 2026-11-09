import { and, customer, eq, serviceDb, site, tenant } from '@flake/db';
import { z } from 'zod';
import { baseUrl } from '@/lib/env';
import { clientIp, HttpError, parseJson, rateLimit, route } from '@/lib/http';
import { notifyOffice } from '@/lib/messaging';
import { resolvePortal } from '@/lib/portal';

const body = z.object({ site_id: z.string().uuid(), note: z.string().trim().max(300).optional() });

/**
 * "Can you come back?" from the customer's records page. The office gets a push, an email, and a text if it has a
 * number, with a link to the customer. One request per lot per hour reaches the office; repeats just confirm.
 */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  rateLimit(`portal-request:${clientIp(req)}`, 10, 60_000);
  const who = await resolvePortal((await params).token);
  if (!who) throw new HttpError(404, 'This link is no longer active.');
  const { site_id, note } = await parseJson(req, body);
  const db = serviceDb();
  const [row] = await db.select({ site, customer, tenant }).from(site)
    .innerJoin(customer, eq(customer.id, site.customer_id))
    .innerJoin(tenant, eq(tenant.id, site.tenant_id))
    .where(and(eq(site.id, site_id), eq(site.customer_id, who.customerId), eq(site.tenant_id, who.tenantId), eq(site.active, true)));
  if (!row) throw new HttpError(404, 'Site not found');
  const hour = Math.floor(Date.now() / 3_600_000);
  const said = note ? ` "${note.replace(/\s+/g, ' ')}"` : '';
  await notifyOffice(row.tenant, {
    headline: `${row.customer.name} asked for a visit at ${row.site.label}.${said}`,
    link: `${baseUrl()}/customers/${row.customer.id}`,
    key: `visit_request:${row.site.id}:${hour}`,
    related: { site_id: row.site.id, customer_id: row.customer.id },
  });
  return { ok: true };
});
