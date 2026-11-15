import { equipmentLogCreate } from '@flake/contracts';
import { equipment_log } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';

/** Fuel, hours and maintenance against a truck. The truck and storm must be this company's (checked in the database). */
export const { GET, POST } = collectionRoutes(equipment_log as any, equipmentLogCreate, {
  transform: (body) => ({ ...body, at: body.at ?? new Date().toISOString() }),
});
