import { crewUpdate } from '@flake/contracts';
import { crew_member } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

// Crew have visit history, so removing one just deactivates them.
export const { GET, PATCH, DELETE } = itemRoutes(crew_member as any, crewUpdate, { softDelete: { active: false } });
