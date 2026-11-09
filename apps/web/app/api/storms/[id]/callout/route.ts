import { stormCallOut } from '@flake/contracts';
import { and, crew_member, eq, route as routeTable, serviceDb, storm, storm_run, tenant } from '@flake/db';
import { requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { sendSms } from '@/lib/messaging';

/** "Can you run West?" Replies come back through the inbound webhook and show on the board. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const { time } = await parseJson(req, stormCallOut);
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, ctx.tenantId));
  const [s] = await db.select({ status: storm.status }).from(storm).where(and(eq(storm.id, id), eq(storm.tenant_id, ctx.tenantId)));
  if (!s) throw new HttpError(404, 'Storm not found');
  if (s.status !== 'active') throw new HttpError(409, 'This storm is closed.', 'closed');
  const runs = await db.select({ run: storm_run, crew: crew_member, route: routeTable }).from(storm_run).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).leftJoin(routeTable, eq(routeTable.id, storm_run.route_id)).where(eq(storm_run.storm_id, id));
  let sent = 0;
  for (const r of runs) {
    if (r.run.tenant_id !== ctx.tenantId || !r.crew?.phone_e164 || !r.crew.active) continue;
    const ok = await sendSms(t!, { to: r.crew.phone_e164, template: 'call_out', vars: { company: t!.name, time, route: r.route?.name ?? 'a route' }, key: `callout:${id}:${r.crew.id}:${time.trim().toLowerCase()}`, related: { storm_id: id } });
    if (!ok) continue;
    sent++;
    // The board shows their answer to this question, not one left over from an earlier storm.
    await db.update(crew_member).set({ callout_reply: null, callout_reply_at: null }).where(and(eq(crew_member.id, r.crew.id), eq(crew_member.tenant_id, ctx.tenantId)));
  }
  return { sent };
});
