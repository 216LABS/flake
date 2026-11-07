import { pinCreate } from '@flake/contracts';
import { site_pin } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

export const { DELETE } = itemRoutes(site_pin as any, pinCreate.partial());
