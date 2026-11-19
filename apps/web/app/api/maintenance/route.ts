import { maintenanceCreate } from '@flake/contracts';
import { and, eq, maintenance_item, truck } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { listMaintenance } from '@/lib/maintenance';

/** Maintenance reminders on every active truck, with where each stands (issue 161). */
export const GET = route(async () => {
  const ctx = await requireApi('viewer');
  return { items: await asUser(ctx, (tx) => listMaintenance(tx)) };
});

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const body = await parseJson(req, maintenanceCreate);
  return asUser(ctx, async (tx) => {
    const [t] = await tx.select({ id: truck.id }).from(truck).where(and(eq(truck.id, body.truck_id), eq(truck.active, true)));
    if (!t) throw new HttpError(404, 'Truck not found');
    const [row] = await tx.insert(maintenance_item).values({
      tenant_id: ctx.tenantId,
      truck_id: body.truck_id,
      name: body.name,
      every_hours: body.every_hours ?? null,
      every_days: body.every_days ?? null,
      last_done_hours: body.last_done_hours ?? null,
      // A date without a time is that day, at noon UTC so it reads as that day everywhere.
      last_done_at: body.last_done_at ? `${body.last_done_at}T12:00:00Z` : null,
    }).returning();
    return row;
  });
});
