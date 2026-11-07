import { customerUpdate } from '@flake/contracts';
import { customer } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

export const { GET, PATCH, DELETE } = itemRoutes(customer as any, customerUpdate);
