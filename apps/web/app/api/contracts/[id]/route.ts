import { contractUpdate } from '@flake/contracts';
import { contract, eq } from '@flake/db';
import { itemRoutes } from '@/lib/crud';
import { HttpError } from '@/lib/http';

/**
 * A signed contract is what the customer agreed to and what they're billed on, so it can only be voided, never
 * edited or pulled back to draft. Changing terms means a new quote they sign again.
 */
export const { GET, PATCH } = itemRoutes(contract as any, contractUpdate, {
  beforeUpdate: async (tx, id, body) => {
    const [c] = await tx.select({ status: contract.status }).from(contract).where(eq(contract.id, id)).for('update');
    if (!c) return;
    const onlyVoid = Object.keys(body).every((k) => k === 'status') && body.status === 'void';
    if (c.status === 'accepted' && !onlyVoid) throw new HttpError(409, 'This contract is signed. Void it and send a new quote to change the terms.', 'signed');
    if (c.status === 'void' && Object.keys(body).length) throw new HttpError(409, 'This contract is void.', 'void');
  },
});
