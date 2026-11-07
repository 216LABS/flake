import { and, eq, membership, serviceDb, sql, tenant } from '@flake/db';
import { adminClient } from './blob';
import { baseUrl } from './env';
import { HttpError } from './http';
import { queueNotify } from './messaging';

export async function listTeam(tenantId: string) {
  return (await serviceDb().execute(sql`
    select m.user_id, u.email, m.role from membership m join auth.users u on u.id = m.user_id
    where m.tenant_id = ${tenantId} order by m.role, u.email`)) as unknown as { user_id: string; email: string | null; role: string }[];
}

/** One company per person in v1, because the app has no company switcher. */
export async function addMember(tenantId: string, email: string, role: 'owner' | 'dispatcher' | 'viewer') {
  const db = serviceDb();
  const address = email.trim().toLowerCase();
  const found = (await db.execute(sql`select id from auth.users where lower(email) = ${address} limit 1`)) as unknown as { id: string }[];
  let userId = found[0]?.id;
  if (!userId) {
    const { data, error } = await adminClient().auth.admin.createUser({ email: address, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not create the user: ${error?.message}`);
    userId = data.user.id;
  }
  const [other] = await db.select().from(membership).where(eq(membership.user_id, userId));
  if (other?.tenant_id === tenantId) throw new HttpError(409, 'They are already on your team.', 'already_member');
  if (other) throw new HttpError(409, 'That email already belongs to another company on Flake.', 'other_company');
  await db.insert(membership).values({ tenant_id: tenantId, user_id: userId, role });
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  await queueNotify(tenantId, { email: address }, { template: 'team_invite', vars: { link: `${baseUrl()}/login` }, subject: `${t!.name} added you to Flake`, key: `team_invite:${userId}` });
  return { user_id: userId };
}

export async function removeMember(tenantId: string, userId: string, by: string) {
  if (userId === by) throw new HttpError(409, 'You cannot remove yourself.', 'self');
  const db = serviceDb();
  const removed = await db.delete(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.user_id, userId))).returning();
  if (!removed.length) throw new HttpError(404, 'Not found');
}
