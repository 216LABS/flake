import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, membership, serviceDb, sql } from '@flake/db';
import { addMember, removeMember } from '@/lib/team';
import { makeWorld } from './helpers';

afterAll(() => closeDb());

const newUser = async () => {
  const id = randomUUID();
  const email = `t-${id}@flake.test`;
  await serviceDb().execute(sql`insert into auth.users (id, email, aud, role, instance_id) values (${id}, ${email}, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`);
  return { id, email };
};

describe('team', () => {
  it('two companies adding the same person at once: only one gets them', async () => {
    const [a, b] = [await makeWorld(), await makeWorld()];
    const u = await newUser();
    const tries = await Promise.allSettled([addMember(a.tenantId, u.email, 'dispatcher'), addMember(b.tenantId, u.email, 'dispatcher')]);
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
    expect(await serviceDb().select().from(membership).where(eq(membership.user_id, u.id))).toHaveLength(1);
  });

  it('two owners removing each other at once leaves one owner', async () => {
    const w = await makeWorld();
    const second = await newUser();
    await serviceDb().insert(membership).values({ tenant_id: w.tenantId, user_id: second.id, role: 'owner' });
    const tries = await Promise.allSettled([removeMember(w.tenantId, second.id, w.userId), removeMember(w.tenantId, w.userId, second.id)]);
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
    const owners = await serviceDb().select().from(membership).where(and(eq(membership.tenant_id, w.tenantId), eq(membership.role, 'owner')));
    expect(owners).toHaveLength(1);
  });

  it('the last owner cannot be removed', async () => {
    const w = await makeWorld();
    await expect(removeMember(w.tenantId, w.userId, w.viewerId)).rejects.toMatchObject({ status: 403 });
    await serviceDb().update(membership).set({ role: 'owner' }).where(eq(membership.user_id, w.viewerId));
    await removeMember(w.tenantId, w.userId, w.viewerId);
    await expect(removeMember(w.tenantId, w.viewerId, randomUUID())).rejects.toMatchObject({ status: 403 });
  });
});
