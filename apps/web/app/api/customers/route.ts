import { customerCreate } from '@flake/contracts';
import { customer } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';

export const { GET, POST } = collectionRoutes(customer as any, customerCreate);
