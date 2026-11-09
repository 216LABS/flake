import { crewUpdate } from '@flake/contracts';
import { and, crew_member, eq, isNull, sql, storm_run, type Tx } from '@flake/db';
import { itemRoutes } from '@/lib/crud';

/**
 * Someone who leaves loses their open route links at once, the same as Revoke link: they can't see customer addresses
 * or start work, but anything they finished before still syncs.
 */
async function retireLinks(tx: Tx, crewId: string) {
  await tx.update(storm_run).set({ link_revoked_at: new Date().toISOString() })
    .where(and(eq(storm_run.crew_id, crewId), isNull(storm_run.link_revoked_at), sql`${storm_run.link_expires_at} > now()`));
}

// Crew have visit history, so removing one just deactivates them.
export const { GET, PATCH, DELETE } = itemRoutes(crew_member as any, crewUpdate, {
  softDelete: { active: false },
  afterDelete: retireLinks,
  afterUpdate: async (tx, id, body) => {
    if (body.active === false) await retireLinks(tx, id);
  },
});
