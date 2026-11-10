import { and, isNull, ne, route, sql, type Tx } from '@flake/db';
import { HttpError } from './http';

/** Two routes with the same name can't be told apart on the storm form or the board (issue 9). */
export async function requireFreeRouteName(tx: Tx, name: string | undefined, except?: string) {
  if (name === undefined) return;
  const clash = await tx.select({ id: route.id }).from(route).where(and(sql`lower(${route.name}) = lower(${name.trim()})`, isNull(route.archived_at), except ? ne(route.id, except) : undefined)).limit(1);
  if (clash.length) throw new HttpError(409, `There's already a route called ${name.trim()}. Give this one another name.`, 'name_taken');
}

/** archived: true / false in the request becomes the archived_at time. */
export const archivedAt = (archived: boolean | undefined) => (archived === undefined ? {} : { archived_at: archived ? new Date().toISOString() : null });
