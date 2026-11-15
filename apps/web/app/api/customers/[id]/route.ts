import { customerUpdate } from '@flake/contracts';
import { customer, eq } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';
import { archivedAt } from '@/lib/routes';
import { restoreWithCustomer, retireWithCustomer } from '@/lib/sites';

/**
 * Archiving keeps the customer's history. Their lots are retired with them, so no new storm or invoice reaches them.
 * Restoring brings those lots back (issue 150).
 */
export const { GET, PATCH, DELETE } = itemRoutes(customer as any, customerUpdate, {
  transform: ({ archived, expected: _expected, ...rest }) => ({ ...rest, ...archivedAt(archived) }),
  beforeUpdate: async (tx, id, body) => {
    if (body.expected) {
      const [now] = await tx.select().from(customer).where(eq(customer.id, id)).for('update');
      const moved = now ? Object.entries(body.expected).filter(([k, v]) => ((now as Record<string, unknown>)[k] ?? null) !== (v ?? null)) : [];
      if (moved.length) throw new HttpError(409, 'Someone else changed this customer since you opened it. Reload to see their changes, then make yours again.', 'stale_edit');
    }
    // Only a real restore brings lots back; saving an already-live customer with archived: false changes nothing.
    if (body.archived !== false) return;
    const [c] = await tx.select({ archived_at: customer.archived_at, tenant_id: customer.tenant_id }).from(customer).where(eq(customer.id, id));
    if (c?.archived_at) await restoreWithCustomer(tx, c.tenant_id, id);
  },
  afterUpdate: async (tx, id, body, tenantId) => {
    if (body.archived === true) await retireWithCustomer(tx, tenantId, id);
  },
});
