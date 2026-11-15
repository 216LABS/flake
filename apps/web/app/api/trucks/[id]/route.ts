import { truckUpdate } from '@flake/contracts';
import { and, eq, ne, sql, truck } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';

/** A truck's log and past storms stay on file, so removing one retires it instead. */
export const { GET, PATCH, DELETE } = itemRoutes(truck as any, truckUpdate, {
  softDelete: { active: false },
  beforeUpdate: async (tx, id, body) => {
    const [now] = await tx.select().from(truck).where(eq(truck.id, id));
    if (!now) return;
    const name = body.name ?? now.name;
    if (body.active === false || (body.active === undefined && !now.active)) return;
    const [clash] = await tx.select({ id: truck.id }).from(truck).where(and(sql`lower(${truck.name}) = lower(${name})`, eq(truck.active, true), ne(truck.id, id))).limit(1);
    if (clash) throw new HttpError(409, `You already have a truck called ${name}.`, 'truck_name_taken');
  },
});
