import { siteUpdate } from '@flake/contracts';
import { site } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

// Sites have visit history, so "delete" retires them instead of removing them.
export const { GET, PATCH, DELETE } = itemRoutes(site as any, siteUpdate, { softDelete: { active: false } });
