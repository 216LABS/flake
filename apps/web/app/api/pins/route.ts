import { pinCreate } from '@flake/contracts';
import { site_pin } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';

export const { GET, POST } = collectionRoutes(site_pin as any, pinCreate);
