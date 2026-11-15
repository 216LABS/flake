import { equipmentLogCreate } from '@flake/contracts';
import { equipment_log } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

/** A log line entered by mistake can be removed. */
export const { GET, DELETE } = itemRoutes(equipment_log as any, equipmentLogCreate);
