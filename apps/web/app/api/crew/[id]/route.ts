import { crewUpdate } from '@flake/contracts';
import { and, crew_member, eq, isNotNull, isNull, sql, storm, storm_run, type Tx } from '@flake/db';
import { enqueue } from '@/lib/jobs';
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
  afterUpdate: async (tx, id, body, tenantId) => {
    if (body.active === false) return retireLinks(tx, id);
    // A corrected email or phone gets the routes they're on now, so a rejected address can be fixed mid-storm (issue 49).
    if (body.email === undefined && body.phone_e164 === undefined) return;
    const runs = await tx.select({ id: storm_run.id }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id))
      .where(and(eq(storm_run.crew_id, id), eq(storm.status, 'active'), isNotNull(storm_run.published_at), isNull(storm_run.link_revoked_at)));
    const to = `${body.email ?? ''}|${body.phone_e164 ?? ''}`;
    for (const r of runs) await enqueue('storm.publish_links', { tenantId, runId: r.id }, { dedupeKey: `publish:${r.id}:${id}:${to}` });
  },
});
