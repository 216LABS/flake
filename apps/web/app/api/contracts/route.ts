import { contractCreate } from '@flake/contracts';
import { contract } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';

export const { GET, POST } = collectionRoutes(contract as any, contractCreate);
