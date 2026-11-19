import { saltOnHand, saltTons, type StockEntry } from '@flake/core/reports';
import { and, app_setting, asc, eq, salt_ledger, serviceDb, sql, tenant, yard, type Conn } from '@flake/db';

/**
 * Salt yards (issue 169). Decisions (Nov 19):
 * - Every company has at least one yard. The first is made from the company's yard address the first time it's needed,
 *   and any salt stock logged before yards existed moves into it, once.
 * - On hand = the latest count, plus deliveries and adjustments after it, minus salt spread on lots after it. Salt
 *   spread is read from the visits (with billing-review corrections, voided visits left out), so it is never out of
 *   step with the visits. A run's salt comes from its yard, or the first yard when none is set.
 * - Bags count as 50 lb. "Application" has no weight, so it doesn't change the pile.
 * - Cost: average cost per ton of deliveries that carry a cost. Profit per lot (issue 167) uses it.
 * - Reorder alerts are on the dashboard only (no email, D16).
 */

export type YardRow = typeof yard.$inferSelect;

/** The company's yards, making the first one (and moving old stock into it) when there are none. */
export async function yardsFor(tenantId: string, db: Conn = serviceDb()): Promise<YardRow[]> {
  const rows = await db.select().from(yard).where(and(eq(yard.tenant_id, tenantId), eq(yard.active, true))).orderBy(asc(yard.created_at));
  if (rows.length) return rows;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`yard:${tenantId}`}))`);
    const again = await tx.select().from(yard).where(and(eq(yard.tenant_id, tenantId), eq(yard.active, true))).orderBy(asc(yard.created_at));
    if (again.length) return again;
    const [t] = await tx.select({ yard: tenant.yard }).from(tenant).where(eq(tenant.id, tenantId));
    const [made] = await tx.insert(yard).values({ tenant_id: tenantId, name: 'Main yard', address: t?.yard?.address ?? null, lat: t?.yard?.lat ?? null, lon: t?.yard?.lon ?? null }).returning();
    const [old] = await tx.select().from(app_setting).where(eq(app_setting.key, `salt_stock:${tenantId}`));
    const entries = ((old?.value as { entries?: StockEntry[] } | undefined)?.entries ?? []).filter((e) => e.kind === 'count' || e.tons !== 0);
    if (entries.length) {
      await tx.insert(salt_ledger).values(entries.map((e) => ({ tenant_id: tenantId, yard_id: made!.id, qty_tons: e.tons, source: e.kind === 'count' ? ('count' as const) : ('delivery' as const), note: e.note ?? null, at: e.at })));
    }
    return [made!];
  });
}

export interface YardStock {
  yard: YardRow;
  tons: number;
  since: string | null;
  low: boolean;
  /** Average cost per ton of deliveries with a cost, in cents; null when none have one. */
  costPerTon: number | null;
  entries: (typeof salt_ledger.$inferSelect)[];
}

/** Salt spread per yard: each visit's salt (as corrected), from its run's yard or the first yard. */
async function usesByYard(db: Conn, tenantId: string, firstYard: string) {
  const rows = (await db.execute(sql`
    select coalesce(sr.yard_id, ${firstYard}::uuid) as yard_id, v.arrived_device_at as at,
      coalesce((select c.new_value from visit_correction c where c.visit_id = v.id and c.field = 'salt' order by c.created_at desc limit 1), v.salt) as salt
    from visit v left join run_stop rs on rs.id = v.run_stop_id left join storm_run sr on sr.id = rs.storm_run_id
    where v.tenant_id = ${tenantId}
      and (v.salt is not null or exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'salt'))
      and not exists (select 1 from visit_correction c where c.visit_id = v.id and c.field = 'voided' and c.new_value = 'true'::jsonb)`)) as unknown as { yard_id: string; at: string | Date; salt: { unit: string; qty: number }[] | null }[];
  const out = new Map<string, { at: string; tons: number }[]>();
  for (const r of rows) {
    const tons = (r.salt ?? []).reduce((n, e) => n + (saltTons(e.unit, Number(e.qty)) ?? 0), 0);
    if (tons) out.set(r.yard_id, [...(out.get(r.yard_id) ?? []), { at: new Date(r.at).toISOString(), tons }]);
  }
  return out;
}

export async function yardStock(tenantId: string, db: Conn = serviceDb()): Promise<YardStock[]> {
  const yards = await yardsFor(tenantId, db);
  const ledger = await db.select().from(salt_ledger).where(eq(salt_ledger.tenant_id, tenantId)).orderBy(asc(salt_ledger.at));
  const uses = await usesByYard(db, tenantId, yards[0]!.id);
  return yards.map((y) => {
    const mine = ledger.filter((l) => l.yard_id === y.id);
    const entries: StockEntry[] = mine.map((l) => ({ id: l.id, kind: l.source === 'count' ? 'count' : 'delivery', at: new Date(l.at).toISOString(), tons: Number(l.qty_tons) }));
    const stock = saltOnHand(entries, uses.get(y.id) ?? []);
    const priced = mine.filter((l) => l.source !== 'count' && l.cost_cents != null && Number(l.qty_tons) > 0);
    const tons = priced.reduce((a, l) => a + Number(l.qty_tons), 0);
    const costPerTon = tons > 0 ? Math.round(priced.reduce((a, l) => a + l.cost_cents!, 0) / tons) : null;
    return { yard: y, tons: stock.tons, since: stock.since, low: y.reorder_tons != null && stock.tons <= Number(y.reorder_tons), costPerTon, entries: [...mine].reverse().slice(0, 30) };
  });
}

/** The company's average salt cost per ton across its yards, for profit (issue 167). */
export async function saltCostPerTon(tenantId: string, db: Conn = serviceDb()): Promise<number | null> {
  const [r] = (await db.execute(sql`
    select case when sum(qty_tons) > 0 then round(sum(cost_cents) / sum(qty_tons))::int end as c
    from salt_ledger where tenant_id = ${tenantId} and source <> 'count' and cost_cents is not null and qty_tons > 0`)) as unknown as { c: number | null }[];
  return r?.c ?? null;
}
