import { desc, eq, serviceDb, sql, tenant } from '@flake/db';
import { isLocalOrTest } from './env';
import { HttpError } from './http';

/**
 * Who may turn a company's sending on or off (issue 171): the ADMIN_EMAILS list only, never a company's own owner. Local
 * and test runs with no list treat everyone as an admin, like the other admin pages; with a list, it applies there too.
 */
export function isOutboundAdmin(email: string | null | undefined): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return isLocalOrTest();
  return Boolean(email && admins.includes(email.toLowerCase()));
}

/** Every company, with whether Flake sends for it, for the admin page. */
export async function listOutbound() {
  return serviceDb().select({
    id: tenant.id, name: tenant.name, slug: tenant.slug, created_at: tenant.created_at, outbound_enabled: tenant.outbound_enabled,
    outbound_changed_at: tenant.outbound_changed_at, outbound_changed_by: tenant.outbound_changed_by, sms_status: tenant.sms_status,
    owner: sql<string | null>`(select u.email from membership m join auth.users u on u.id = m.user_id where m.tenant_id = ${tenant.id} and m.role = 'owner' order by u.created_at limit 1)`,
  }).from(tenant).orderBy(desc(tenant.created_at));
}

/** Turns sending on or off for exactly one company, with who did it and when. */
export async function setOutbound(by: string | null, tenantId: string, enabled: boolean) {
  if (!isOutboundAdmin(by)) throw new HttpError(403, 'Only 216LABS can turn sending on for a company.');
  const rows = await serviceDb().update(tenant).set({ outbound_enabled: enabled, outbound_changed_at: new Date().toISOString(), outbound_changed_by: by ?? 'unknown' })
    .where(eq(tenant.id, tenantId)).returning({ id: tenant.id, outbound_enabled: tenant.outbound_enabled });
  if (!rows.length) throw new HttpError(404, 'Not found');
  return rows[0]!;
}
