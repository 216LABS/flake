import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * as schema from './schema';
export * from './schema';
export { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Conn = Db | Tx;

const globalForDb = globalThis as unknown as { __flakeSql?: postgres.Sql; __flakeDb?: Db };

/** The server connection. It bypasses RLS, so every query through it needs an explicit tenant filter. */
export function serviceDb(): Db {
  if (!globalForDb.__flakeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.__flakeSql = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 10), onnotice: () => {} });
    globalForDb.__flakeDb = drizzle(globalForDb.__flakeSql, { schema });
  }
  return globalForDb.__flakeDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__flakeSql?.end({ timeout: 5 });
  globalForDb.__flakeSql = undefined;
  globalForDb.__flakeDb = undefined;
}

/**
 * Runs `fn` in a transaction as the signed-in Supabase user, with RLS enforced by Postgres.
 * This is the only path office requests use to read and write tenant data.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return serviceDb().transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`);
    return fn(tx);
  });
}

/**
 * Scoped queries for driver link tokens. Driver requests have no Supabase user, so they use the service
 * connection. Going through this helper keeps a tenant filter on every read (BUILD_SPEC section 2).
 */
export function driverScope(db: Conn, scope: { tenantId: string; runId: string; crewId: string | null; stormId: string }) {
  return {
    ...scope,
    db,
    stops: () => db.select().from(schema.run_stop).where(and(eq(schema.run_stop.tenant_id, scope.tenantId), eq(schema.run_stop.storm_run_id, scope.runId))),
    /** A stop this run holds now or held before it was moved. Anything else is out of scope. */
    stop: async (stopId: string) => {
      const rows = await db
        .select()
        .from(schema.run_stop)
        .where(and(eq(schema.run_stop.tenant_id, scope.tenantId), eq(schema.run_stop.id, stopId), sql`(${schema.run_stop.storm_run_id} = ${scope.runId} or ${scope.runId}::uuid = any(${schema.run_stop.previous_run_ids}))`));
      return rows[0] ?? null;
    },
    visit: async (clientUuid: string) => {
      const rows = await db.select().from(schema.visit).where(and(eq(schema.visit.tenant_id, scope.tenantId), eq(schema.visit.client_uuid, clientUuid), eq(schema.visit.crew_id, scope.crewId ?? '00000000-0000-0000-0000-000000000000')));
      return rows[0] ?? null;
    },
  };
}
export type DriverScope = ReturnType<typeof driverScope>;
