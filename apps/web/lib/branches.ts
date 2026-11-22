import { and, asc, branch, crew_member, eq, inArray, isNull, route, serviceDb, site, sql, storm, storm_run, tenant, yard, type Tx } from '@flake/db';
import { geocodeAddress } from './geocode';
import { HttpError } from './http';

/**
 * Branches (issue 227): a multi-yard company's yards, each with its own lots, routes, crew, salt yards and storms, and
 * managers who see only theirs (the database's branch policies do the limiting). A one-yard company never sees any
 * of this: the first branch added also creates "Main" for everything that already exists, so nothing changes for it.
 */
export type Branch = typeof branch.$inferSelect;

/** Drizzle wraps the database error, so the unique-name clash is on its cause. */
const sameName = (e: { code?: string; cause?: { code?: string } }): never => {
  if ((e.code ?? e.cause?.code) === '23505') throw new HttpError(409, 'You already have a branch with that name.', 'branch_name');
  throw e;
};

export async function listBranches(tx: Tx) {
  return tx.select().from(branch).where(isNull(branch.archived_at)).orderBy(asc(branch.created_at));
}

/** How many of each thing a branch holds, for the settings list. */
export async function branchCounts(tx: Tx) {
  const rows = (await tx.execute(sql`
    select b.id,
      (select count(*)::int from site s where s.branch_id = b.id and s.active) as sites,
      (select count(*)::int from route r where r.branch_id = b.id and r.archived_at is null) as routes,
      (select count(*)::int from crew_member c where c.branch_id = b.id and c.active) as crew,
      (select count(*)::int from yard y where y.branch_id = b.id) as yards
    from branch b where b.archived_at is null`)) as unknown as { id: string; sites: number; routes: number; crew: number; yards: number }[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function yardFrom(address: string | null | undefined) {
  if (!address?.trim()) return null;
  try {
    const g = await geocodeAddress(address.trim());
    return { address: address.trim(), lat: g.lat, lon: g.lon };
  } catch {
    throw new HttpError(422, `We couldn't find "${address.trim()}" on the map. Check the street and town.`, 'yard_not_found');
  }
}

export async function createBranch(tx: Tx, tenantId: string, b: { name: string; yard_address?: string | null; timezone?: string | null }) {
  const yardAt = await yardFrom(b.yard_address);
  // One at a time, so two people adding the first branch at once don't both make "Main".
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`branch:${tenantId}`}))`);
  const have = await tx.select({ id: branch.id }).from(branch).where(eq(branch.tenant_id, tenantId));
  if (!have.length) {
    // Everything that exists today becomes the Main branch, with the company's yard, so the new one starts empty.
    const [t] = await serviceDb().select({ yard: tenant.yard }).from(tenant).where(eq(tenant.id, tenantId));
    const [main] = await tx.insert(branch).values({ tenant_id: tenantId, name: b.name.trim().toLowerCase() === 'main' ? 'Main yard' : 'Main', yard: t?.yard ?? null }).returning();
    for (const table of [site, route, crew_member, yard, storm] as const) await tx.update(table).set({ branch_id: main!.id }).where(and(eq(table.tenant_id, tenantId), isNull(table.branch_id)));
  }
  const [row] = await tx.insert(branch).values({ tenant_id: tenantId, name: b.name.trim(), yard: yardAt, timezone: b.timezone || null }).returning()
    .catch(sameName);
  return row!;
}

export async function updateBranch(tx: Tx, id: string, b: { name?: string; yard_address?: string | null; timezone?: string | null; archived?: boolean }) {
  const set: Partial<typeof branch.$inferInsert> = {};
  if (b.name !== undefined) set.name = b.name.trim();
  if (b.yard_address !== undefined) set.yard = await yardFrom(b.yard_address);
  if (b.timezone !== undefined) set.timezone = b.timezone || null;
  if (b.archived) {
    const [busy] = (await tx.execute(sql`select (select count(*)::int from site where branch_id = ${id} and active) + (select count(*)::int from route where branch_id = ${id} and archived_at is null) + (select count(*)::int from crew_member where branch_id = ${id} and active) as n`)) as unknown as { n: number }[];
    if (busy?.n) throw new HttpError(409, 'Move this branch’s lots, routes and crew to another branch first.', 'branch_in_use');
    set.archived_at = new Date().toISOString();
  }
  const [row] = await tx.update(branch).set(set).where(eq(branch.id, id)).returning()
    .catch(sameName);
  if (!row) throw new HttpError(404, 'Branch not found');
  return row;
}

const TABLE = { site, route, crew: crew_member, yard } as const;

/** Moves lots, routes, crew or salt yards into a branch. A route's lots go with it unless they're on another branch already. */
export async function assignBranch(tx: Tx, kind: keyof typeof TABLE, ids: string[], branchId: string | null) {
  if (branchId) {
    const [b] = await tx.select({ id: branch.id }).from(branch).where(and(eq(branch.id, branchId), isNull(branch.archived_at)));
    if (!b) throw new HttpError(404, 'Branch not found');
  }
  const t = TABLE[kind];
  const rows = await tx.update(t).set({ branch_id: branchId }).where(inArray(t.id, ids)).returning({ id: t.id });
  return { updated: rows.length };
}

/** A new storm's branch: the one all its routes share, or none (every branch's managers see it) when they're mixed. */
export async function stampStormBranch(tx: Tx, stormId: string) {
  await tx.execute(sql`
    update storm s set branch_id = x.b from (
      select case when count(distinct r.branch_id) = 1 and count(*) filter (where r.branch_id is null) = 0 then min(r.branch_id::text)::uuid end as b
      from storm_run sr join route r on r.id = sr.route_id where sr.storm_id = ${stormId}
    ) x where s.id = ${stormId} and x.b is not null`);
}

/** The yard a route starts and ends at: its branch's yard when it has one, else the company's. */
export async function yardForRoute(tx: Tx, routeId: string | null, fallback: { lat: number; lon: number } | null) {
  if (!routeId) return fallback;
  const [r] = await tx.select({ yard: branch.yard }).from(route).innerJoin(branch, eq(branch.id, route.branch_id)).where(eq(route.id, routeId));
  return r?.yard ? { lat: r.yard.lat, lon: r.yard.lon } : fallback;
}

/** The branch a branch-limited member's new lot, route or driver lands in: their first. Unlimited members pick none. */
export const defaultBranchFor = (branchIds: string[] | null | undefined) => (branchIds?.length ? branchIds[0]! : null);

/** Storm-run lookups used by reports: which storms belong to a branch. */
export const stormInBranch = (branchId: string) => sql`(${storm.branch_id} = ${branchId} or exists (select 1 from ${storm_run} sr join ${route} r on r.id = sr.route_id where sr.storm_id = ${storm.id} and r.branch_id = ${branchId}))`;
