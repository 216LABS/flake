import { customerCreate } from '@flake/contracts';
import { and, customer, sql } from '@flake/db';
import { collectionRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';

/**
 * The same customer sent twice at once (a double tap, a retry on bad signal, a script) makes one customer, not two
 * (issue 135). Two customers can share a name on purpose, so only one added in the last two minutes counts.
 */
export const { GET, POST } = collectionRoutes(customer as any, customerCreate, {
  beforeCreate: async (tx, tenantId, body: { name: string }) => {
    const name = body.name.trim().toLowerCase();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer:${tenantId}:${name}`}))`);
    const [just] = await tx.select({ id: customer.id }).from(customer)
      .where(and(sql`lower(${customer.name}) = ${name}`, sql`${customer.created_at} > now() - interval '2 minutes'`)).limit(1);
    if (just) throw new HttpError(409, `${body.name.trim()} was just added. Open it from Customers instead of adding it again.`, 'just_added');
  },
});
