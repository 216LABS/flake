import { createServerClient } from '@supabase/ssr';
import { and, eq, membership, serviceDb, tenant, withUser, type Tx } from '@flake/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { HttpError } from './http';

export type Role = 'owner' | 'dispatcher' | 'viewer';
export interface OfficeContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: Role;
  tenant: typeof tenant.$inferSelect;
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server components can't set cookies; the proxy refreshes sessions.
        }
      },
    },
  });
}

export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

async function contextFor(user: { id: string; email: string | null }): Promise<OfficeContext | null> {
  const [m] = await serviceDb().select().from(membership).where(eq(membership.user_id, user.id)).limit(1);
  if (!m) return null;
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, m.tenant_id));
  if (!t) return null;
  return { userId: user.id, email: user.email, tenantId: t.id, role: m.role, tenant: t };
}

/** For pages: sends visitors to login, and new users to company setup. */
export async function requirePage(): Promise<OfficeContext> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const ctx = await contextFor(user);
  if (!ctx) redirect('/onboarding');
  return ctx;
}

/** For API routes: 401 with no session, 403 when the role is too low. */
export async function requireApi(minRole: Role = 'viewer'): Promise<OfficeContext> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Sign in first');
  const ctx = await contextFor(user);
  if (!ctx) throw new HttpError(403, 'No company on this account');
  const rank: Record<Role, number> = { viewer: 0, dispatcher: 1, owner: 2 };
  if (rank[ctx.role] < rank[minRole]) throw new HttpError(403, 'Your role cannot do this');
  return ctx;
}

/** Runs as the signed-in user so Postgres RLS applies. */
export const asUser = <T>(ctx: Pick<OfficeContext, 'userId'>, fn: (tx: Tx) => Promise<T>) => withUser(ctx.userId, fn);

export async function isMember(userId: string, tenantId: string) {
  const [m] = await serviceDb().select().from(membership).where(and(eq(membership.user_id, userId), eq(membership.tenant_id, tenantId)));
  return Boolean(m);
}
