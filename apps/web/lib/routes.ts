import { and, eq, isNull, ne, route, sql, type Tx } from '@flake/db';
import { HttpError } from './http';

/** Two routes with the same name can't be told apart on the storm form or the board (issue 9). */
export async function requireFreeRouteName(tx: Tx, name: string | undefined, except?: string) {
  if (name === undefined) return;
  const clash = await tx.select({ id: route.id }).from(route).where(and(sql`lower(${route.name}) = lower(${name.trim()})`, isNull(route.archived_at), except ? ne(route.id, except) : undefined)).limit(1);
  if (clash.length) throw new HttpError(409, `There's already a route called ${name.trim()}. Give this one another name.`, 'name_taken');
}

/**
 * The name a route will have after this change must be free. Restoring an archived route brings its old name back,
 * and a new route may have taken it since (issue 52).
 */
export async function checkRouteUpdate(tx: Tx, id: string, body: { name?: string; archived?: boolean }) {
  if (body.archived === true) return;
  let name = body.name;
  if (name === undefined && body.archived === false) [{ name } = { name: undefined }] = await tx.select({ name: route.name }).from(route).where(eq(route.id, id));
  await requireFreeRouteName(tx, name, id);
}

/** archived: true / false in the request becomes the archived_at time. */
export const archivedAt = (archived: boolean | undefined) => (archived === undefined ? {} : { archived_at: archived ? new Date().toISOString() : null });
