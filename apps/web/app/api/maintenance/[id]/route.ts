import { maintenanceUpdate } from '@flake/contracts';
import { eq, equipment_log, maintenance_item } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, parseJson, route } from '@/lib/http';
import { meterFor } from '@/lib/maintenance';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a reminder done: it starts again from now and from the truck's meter, and the service goes in the truck's log.
 * Or change its name or interval.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, maintenanceUpdate);
  return asUser(ctx, async (tx) => {
    const [m] = await tx.select().from(maintenance_item).where(eq(maintenance_item.id, id)).for('update');
    if (!m) throw new HttpError(404, 'Not found');
    const next = {
      name: body.name ?? m.name,
      every_hours: body.every_hours === undefined ? m.every_hours : body.every_hours,
      every_days: body.every_days === undefined ? m.every_days : body.every_days,
    };
    if (!next.every_hours && !next.every_days) throw new HttpError(400, 'Set every so many hours, days, or both.');
    const done = body.done ? { last_done_at: new Date().toISOString(), last_done_hours: await meterFor(tx, m.truck_id) } : {};
    const [row] = await tx.update(maintenance_item).set({ ...next, ...done }).where(eq(maintenance_item.id, id)).returning();
    if (body.done) {
      await tx.insert(equipment_log).values({ tenant_id: ctx.tenantId, truck_id: m.truck_id, kind: 'maintenance', note: m.name, at: done.last_done_at!, created_by: ctx.userId });
    }
    return row;
  });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const id = (await params).id;
  if (!isUuid(id)) throw new HttpError(404, 'Not found');
  const ctx = await requireApi('dispatcher');
  const gone = await asUser(ctx, (tx) => tx.delete(maintenance_item).where(eq(maintenance_item.id, id)).returning({ id: maintenance_item.id }));
  if (!gone.length) throw new HttpError(404, 'Not found');
  return { ok: true };
});
