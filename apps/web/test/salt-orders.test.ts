import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, eq, job, salt_order, salt_pool, salt_supplier, serviceDb, sql, tenant } from '@flake/db';
import { cancelOrder, createSupplier, placeOrder, quote, resolveSupplier, supplierUpdate } from '@/lib/salt-orders';
import { makeWorld, type World } from './helpers';

afterAll(() => closeDb());

describe('salt ordering', () => {
  let a: World;
  let b: World;
  const ctx = async (w: World) => {
    const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, w.tenantId));
    return { userId: w.userId, email: null, tenantId: w.tenantId, role: 'owner' as const, tenant: t! };
  };

  beforeAll(async () => {
    // Suppliers are shared by everyone, so earlier runs' suppliers are switched off to keep this one the cheapest.
    await serviceDb().update(salt_supplier).set({ active: false });
    a = await makeWorld();
    b = await makeWorld();
  });

  it('two orders that fill a truck at the same moment make exactly one full load and one email', async () => {
    const s = await createSupplier({ name: `Race Salt ${Date.now()}`, email: 'race@flake.test', address: '100 Lake Ave, Lakewood, OH', radius_mi: 60, price_per_ton_cents: 7500, truckload_tons: 22, stop_fee_cents: 5000, referral_fee_per_ton_cents: 300 });
    const [ca, cb] = [await ctx(a), await ctx(b)];
    await Promise.all([placeOrder(ca, { tons: 12, address: '1 Main St, Lakewood, OH' }), placeOrder(cb, { tons: 12, address: '2 Main St, Lakewood, OH' })]);
    const pools = await serviceDb().select().from(salt_pool).where(eq(salt_pool.supplier_id, s.id));
    const orders = await serviceDb().select().from(salt_order).where(eq(salt_order.supplier_id, s.id));
    expect(pools.filter((p) => p.status === 'sent')).toHaveLength(1);
    expect(orders.every((o) => o.status === 'ordered' && o.pool_id === pools.find((p) => p.status === 'sent')!.id)).toBe(true);
    const emails = await serviceDb().select().from(job).where(sql`${job.kind} = 'salt.supplier_email' and ${job.payload}->>'id' in (select id::text from salt_pool where supplier_id = ${s.id})`);
    expect(emails).toHaveLength(1);
  });

  it('pools smaller orders, ships a full truckload alone, and cancels only before the supplier has it', async () => {
    const c = await ctx(a);
    const q = await quote('3 Main St, Lakewood, OH', 5);
    expect(q).toMatchObject({ covered: true, path: { kind: 'pool', fills: false } });
    const small = await placeOrder(c, { tons: 5, address: '3 Main St, Lakewood, OH' });
    expect(small.order.status).toBe('pooling');
    expect(await cancelOrder(c, small.order.id)).toEqual({ ok: true });
    const big = await placeOrder(c, { tons: 22, address: '3 Main St, Lakewood, OH' });
    expect(big.order).toMatchObject({ status: 'ordered', pool_id: null });
    // Another company can't cancel it.
    await expect(cancelOrder(await ctx(b), big.order.id)).rejects.toMatchObject({ status: 404 });
    // Once the supplier has set a date, cancelling is for the phone.
    const [sup] = await serviceDb().select().from(salt_supplier).where(eq(salt_supplier.id, big.order.supplier_id));
    await supplierUpdate(sup!, big.order.id, { delivery_date: '2026-12-01' });
    await expect(cancelOrder(c, big.order.id)).rejects.toMatchObject({ status: 409 });
  });

  it('delivery goes onto the contractor salt count, and supplier links can be turned off', async () => {
    const c = await ctx(b);
    const big = await placeOrder(c, { tons: 30, address: '4 Main St, Lakewood, OH' });
    const [sup] = await serviceDb().select().from(salt_supplier).where(eq(salt_supplier.id, big.order.supplier_id));
    await supplierUpdate(sup!, big.order.id, { delivered_tons: 28.5 });
    const [stock] = (await serviceDb().execute(sql`select value from app_setting where key = ${`salt_stock:${b.tenantId}`}`)) as unknown as { value: { entries: { tons: number; note: string }[] } }[];
    expect(stock!.value.entries.some((e) => e.tons === 28.5 && e.note.includes(sup!.name))).toBe(true);
    // Marking it delivered twice adds nothing.
    await supplierUpdate(sup!, big.order.id, { delivered_tons: 28.5 });
    const [again] = (await serviceDb().execute(sql`select value from app_setting where key = ${`salt_stock:${b.tenantId}`}`)) as unknown as { value: { entries: unknown[] } }[];
    expect(again!.value.entries).toHaveLength(stock!.value.entries.length);
    // Bad and old links resolve to nothing.
    expect(await resolveSupplier('nonsense')).toBeNull();
    expect(await resolveSupplier(`x.${sup!.link_rev}.${'A'.repeat(32)}`)).toBeNull();
  });
});
