import { contractUpdate } from '@flake/contracts';
import { contract } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

export const { GET, PATCH } = itemRoutes(contract as any, contractUpdate);
