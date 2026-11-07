import { stormCallOut } from '@flake/contracts';
import { crew_member, eq, route as routeTable, serviceDb, storm_run, tenant } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { sendSms } from '@/lib/messaging';

/** "Can you run West?" Replies come back through the inbound webhook and show on the board. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  const { time } = await parseJson(req, stormCallOut);
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const runs = await db.select({ run: storm_run, crew: crew_member, route: routeTable }).from(storm_run).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).leftJoin(routeTable, eq(routeTable.id, storm_run.route_id)).where(eq(storm_run.storm_id, id));
  let sent = 0;
  for (const r of runs) {
    if (r.run.tenant_id !== ctx.tenantId || !r.crew?.phone_e164) continue;
    const ok = await sendSms(t!, { to: r.crew.phone_e164, template: 'call_out', vars: { company: t!.name, time, route: r.route?.name ?? 'a route' }, key: `callout:${id}:${r.crew.id}`, related: { storm_id: id } });
    if (ok) sent++;
  }
  return { sent };
});
