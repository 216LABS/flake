import { and, eq, membership, serviceDb, sql, tenant } from '@flake/db';
import { adminClient } from './blob';
import { baseUrl } from './env';
import { HttpError } from './http';
import { queueNotify } from './messaging';

export async function listTeam(tenantId: string) {
  return (await serviceDb().execute(sql`
    select m.user_id, u.email, m.role, u.last_sign_in_at is null as pending from membership m join auth.users u on u.id = m.user_id
    where m.tenant_id = ${tenantId} order by m.role, u.email`)) as unknown as { user_id: string; email: string | null; role: string; pending: boolean }[];
}

/** One company per person in v1, because the app has no company switcher. */
export async function addMember(tenantId: string, email: string, role: 'owner' | 'dispatcher' | 'viewer') {
  const db = serviceDb();
  const address = email.trim().toLowerCase();
  const found = (await db.execute(sql`select id from auth.users where lower(email) = ${address} limit 1`)) as unknown as { id: string }[];
  let userId = found[0]?.id;
  if (!userId) {
    const { data, error } = await adminClient().auth.admin.createUser({ email: address, email_confirm: true });
    if (data?.user) userId = data.user.id;
    else {
      // Two invites at once: the other one created the account first.
      const again = (await db.execute(sql`select id from auth.users where lower(email) = ${address} limit 1`)) as unknown as { id: string }[];
      if (!again[0]) throw new Error(`Could not create the user: ${error?.message}`);
      userId = again[0].id;
    }
  }
  const uid = userId;
  await db.transaction(async (tx) => {
    // One company per person: two companies adding the same person at once must not both get them.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`member:${uid}`}))`);
    const [other] = await tx.select().from(membership).where(eq(membership.user_id, uid));
    if (other?.tenant_id === tenantId) throw new HttpError(409, 'They are already on your team.', 'already_member');
    if (other) throw new HttpError(409, 'That email already belongs to another company on Flake.', 'other_company');
    await tx.insert(membership).values({ tenant_id: tenantId, user_id: uid, role });
  });
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  await queueNotify(tenantId, { email: address }, { template: 'team_invite', vars: { link: `${baseUrl()}/login` }, subject: `${t!.name} added you to Flake`, key: `team_invite:${userId}` });
  return { user_id: userId };
}

/** Sends the sign-in invite again, to someone who hasn't signed in yet. */
export async function resendInvite(tenantId: string, userId: string) {
  const db = serviceDb();
  const [row] = (await db.execute(sql`
    select u.email, u.last_sign_in_at from membership m join auth.users u on u.id = m.user_id
    where m.tenant_id = ${tenantId} and m.user_id = ${userId}`)) as unknown as { email: string | null; last_sign_in_at: string | null }[];
  if (!row?.email) throw new HttpError(404, 'Not found');
  if (row.last_sign_in_at) throw new HttpError(409, 'They have already signed in. They can sign in any time at the sign-in page.', 'signed_in');
  const [t] = await db.select().from(tenant).where(eq(tenant.id, tenantId));
  // A fresh key per press, a minute apart, so a resend actually sends and a double tap doesn't send twice.
  await queueNotify(tenantId, { email: row.email }, { template: 'team_invite', vars: { link: `${baseUrl()}/login` }, subject: `${t!.name} added you to Flake`, key: `team_invite:${userId}:${Math.floor(Date.now() / 60_000)}` });
  return { ok: true };
}

/** Changes someone's role. The company always keeps an owner, and only a current owner can do it. */
export async function changeRole(tenantId: string, userId: string, role: 'owner' | 'dispatcher' | 'viewer', by: string) {
  await serviceDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`team:${tenantId}`}))`);
    const [me] = await tx.select().from(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.user_id, by), eq(membership.role, 'owner')));
    if (!me) throw new HttpError(403, 'You are no longer an owner of this company.', 'not_owner');
    const changed = await tx.update(membership).set({ role }).where(and(eq(membership.tenant_id, tenantId), eq(membership.user_id, userId))).returning();
    if (!changed.length) throw new HttpError(404, 'Not found');
    const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.role, 'owner')));
    if (!left?.n) throw new HttpError(409, 'A company needs at least one owner.', 'last_owner');
  });
  return { ok: true };
}

export async function removeMember(tenantId: string, userId: string, by: string) {
  if (userId === by) throw new HttpError(409, 'You cannot remove yourself.', 'self');
  await serviceDb().transaction(async (tx) => {
    // Two owners removing each other at once must not leave the company with no owner.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`team:${tenantId}`}))`);
    // Whoever is removing must still be an owner here; another owner may have just removed them.
    const [me] = await tx.select().from(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.user_id, by), eq(membership.role, 'owner')));
    if (!me) throw new HttpError(403, 'You are no longer an owner of this company.', 'not_owner');
    const removed = await tx.delete(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.user_id, userId))).returning();
    if (!removed.length) throw new HttpError(404, 'Not found');
    const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(membership).where(and(eq(membership.tenant_id, tenantId), eq(membership.role, 'owner')));
    if (!left?.n) throw new HttpError(409, 'A company needs at least one owner.', 'last_owner');
  });
}
