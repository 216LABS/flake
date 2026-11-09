import { and, eq, sql, withUser, type Tx } from '@flake/db';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { requireApi } from './auth';
import { HttpError, parseJson, route } from './http';

type ParamCtx = { params: Promise<{ id: string }> };
type T = PgTable & { id: PgColumn; tenant_id: PgColumn };

/** List and create for a tenant table. RLS is the guard; the tenant id comes from the session, never the body. */
export function collectionRoutes<S extends z.ZodTypeAny>(table: T, schema: S, opts: { afterCreate?: (tx: Tx, row: any, body: z.infer<S>, tenantId: string) => Promise<void>; transform?: (body: z.infer<S>) => Record<string, unknown>; beforeCreate?: (tx: Tx, tenantId: string) => Promise<void> } = {}) {
  return {
    GET: route(async () => {
      const ctx = await requireApi('viewer');
      return { items: await withUser(ctx.userId, (tx) => tx.select().from(table as any).orderBy(sql`created_at desc`)) };
    }),
    POST: route(async (req: Request) => {
      const ctx = await requireApi('dispatcher');
      const body = await parseJson(req, schema);
      const row = await withUser(ctx.userId, async (tx) => {
        await opts.beforeCreate?.(tx, ctx.tenantId);
        const values = { ...(opts.transform ? opts.transform(body) : (body as Record<string, unknown>)), tenant_id: ctx.tenantId };
        const [created] = await tx.insert(table as any).values(values as any).returning();
        await opts.afterCreate?.(tx, created, body, ctx.tenantId);
        return created;
      });
      return NextResponse.json(row, { status: 201 });
    }),
  };
}

export function itemRoutes<S extends z.ZodTypeAny>(table: T, schema: S, opts: { beforeUpdate?: (tx: Tx, id: string, body: z.infer<S>) => Promise<void>; afterUpdate?: (tx: Tx, id: string, body: z.infer<S>, tenantId: string) => Promise<void>; transform?: (body: z.infer<S>) => Record<string, unknown>; softDelete?: Record<string, unknown>; afterDelete?: (tx: Tx, id: string) => Promise<void> } = {}) {
  return {
    GET: route<ParamCtx>(async (_req, { params }) => {
      const ctx = await requireApi('viewer');
      const { id } = await params;
      const [row] = await withUser(ctx.userId, (tx) => tx.select().from(table as any).where(eq(table.id, id)));
      if (!row) throw new HttpError(404, 'Not found');
      return row;
    }),
    PATCH: route<ParamCtx>(async (req, { params }) => {
      const ctx = await requireApi('dispatcher');
      const { id } = await params;
      const body = await parseJson(req, schema);
      return withUser(ctx.userId, async (tx) => {
        await opts.beforeUpdate?.(tx, id, body);
        const values = opts.transform ? opts.transform(body) : (body as Record<string, unknown>);
        const rows = Object.keys(values).length ? await tx.update(table as any).set(values as any).where(and(eq(table.id, id), eq(table.tenant_id, ctx.tenantId))).returning() : await tx.select().from(table as any).where(eq(table.id, id));
        if (!rows[0]) throw new HttpError(404, 'Not found');
        await opts.afterUpdate?.(tx, id, body, ctx.tenantId);
        return rows[0];
      });
    }),
    DELETE: route<ParamCtx>(async (_req, { params }) => {
      const ctx = await requireApi('dispatcher');
      const { id } = await params;
      const rows = await withUser(ctx.userId, async (tx) => {
        const out = opts.softDelete
          ? await tx.update(table as any).set(opts.softDelete as any).where(eq(table.id, id)).returning()
          : await tx.delete(table as any).where(eq(table.id, id)).returning();
        if (out[0]) await opts.afterDelete?.(tx, id);
        return out;
      });
      if (!rows[0]) throw new HttpError(404, 'Not found');
      return { ok: true };
    }),
  };
}
