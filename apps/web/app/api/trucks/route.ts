import { truckCreate } from '@flake/contracts';
import { and, eq, sql, truck } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';

/** Trucks and other equipment. Two trucks in service can't share a name, so a pick list is never ambiguous. */
export const { GET, POST } = collectionRoutes(truck as any, truckCreate, {
  beforeCreate: async (tx, _tenantId, body) => {
    const [clash] = await tx.select({ id: truck.id }).from(truck).where(and(sql`lower(${truck.name}) = lower(${body.name})`, eq(truck.active, true))).limit(1);
    if (clash) throw new HttpError(409, `You already have a truck called ${body.name}.`, 'truck_name_taken');
  },
});
