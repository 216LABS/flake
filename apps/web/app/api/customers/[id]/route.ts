import { customerUpdate } from '@flake/contracts';
import { customer, eq, site } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { archivedAt } from '@/lib/routes';
import { takeSitesOffWork } from '@/lib/sites';

/** Archiving keeps the customer's history. Their lots are retired with them, so no new storm or invoice reaches them. */
export const { GET, PATCH, DELETE } = itemRoutes(customer as any, customerUpdate, {
  transform: ({ archived, ...rest }) => ({ ...rest, ...archivedAt(archived) }),
  afterUpdate: async (tx, id, body) => {
    if (body.archived !== true) return;
    const lots = await tx.update(site).set({ active: false }).where(eq(site.customer_id, id)).returning({ id: site.id });
    await takeSitesOffWork(tx, lots.map((l) => l.id));
  },
});
