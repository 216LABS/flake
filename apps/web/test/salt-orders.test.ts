import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, eq, job, salt_order, salt_pool, salt_supplier, serviceDb, sql, tenant } from '@flake/db';
import { cancelOrder, createSupplier, placeOrder, quote, resolveSupplier, supplierUpdate, updateSupplier } from '@/lib/salt-orders';
import { OVERFILL, SHIP_AS_IS } from '@flake/core/salt';
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

  describe('a truck never carries more than one load', () => {
    let sid: string;
    const sum = (rows: { tons: number }[]) => Math.round(rows.reduce((n, r) => n + r.tons, 0) * 10) / 10;
    const loads = async () => {
      const pools = await serviceDb().select().from(salt_pool).where(eq(salt_pool.supplier_id, sid));
      const orders = await serviceDb().select().from(salt_order).where(eq(salt_order.supplier_id, sid));
      return pools.map((p) => ({ ...p, orders: orders.filter((o) => o.pool_id === p.id && o.status !== 'cancelled') }));
    };

    beforeAll(async () => {
      await serviceDb().update(salt_supplier).set({ active: false });
      sid = (await createSupplier({ name: `Overflow Salt ${Date.now()}`, email: 'over@flake.test', address: '100 Lake Ave, Lakewood, OH', radius_mi: 60, price_per_ton_cents: 7000, truckload_tons: 22, stop_fee_cents: 5000, referral_fee_per_ton_cents: 300 })).id;
    });

    it('splits an order that would overflow the open load, and starts the next load when the open one is nearly full', async () => {
      const [ca, cb] = [await ctx(a), await ctx(b)];
      await placeOrder(ca, { tons: 5, address: '1 Main St, Lakewood, OH' });
      const split = await placeOrder(cb, { tons: 20, address: '2 Main St, Lakewood, OH' });
      expect(split.path).toEqual({ kind: 'split', nowTons: 17, laterTons: 3 });
      expect(split.orders.map((o) => [o.tons, o.status])).toEqual([[17, 'ordered'], [3, 'pooling']]);
      let all = await loads();
      expect(all.filter((p) => p.status === 'sent').map((p) => sum(p.orders))).toEqual([22]);
      expect(all.filter((p) => p.status === 'open').map((p) => sum(p.orders))).toEqual([3]);

      // 3 + 17 = 20 waiting. Another 10 won't fit, and 20 of 22 is close enough to ship as is.
      await placeOrder(ca, { tons: 17, address: '1 Main St, Lakewood, OH' });
      const next = await placeOrder(cb, { tons: 10, address: '2 Main St, Lakewood, OH' });
      expect(next.path).toEqual({ kind: 'next', shipsNowTons: 20, poolTonsAfter: 10 });
      all = await loads();
      expect(all.filter((p) => p.status === 'sent').map((p) => sum(p.orders)).sort()).toEqual([20, 22]);
      expect(all.filter((p) => p.status === 'open').map((p) => sum(p.orders))).toEqual([10]);
      const quoted = await quote('1 Main St, Lakewood, OH', 18);
      expect(quoted).toMatchObject({ path: { kind: 'split', nowTons: 12, laterTons: 6 }, total_cents: 18 * 7000 + 2 * 5000 });
    });

    it('a rush of small orders all land, and no load goes over the truck', async () => {
      const cs = [await ctx(a), await ctx(b)];
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => placeOrder(cs[i % 2]!, { tons: 3 + (i % 4) * 2, address: `${i + 10} Main St, Lakewood, OH` })));
      expect(results).toHaveLength(12);
      // This has failed twice in about 20 full runs and never alone; the messages say what the loads looked like.
      const all = await loads();
      const state = JSON.stringify(all.map((p) => ({ status: p.status, tons: sum(p.orders) })));
      for (const p of all) expect(sum(p.orders), state).toBeLessThanOrEqual(22 * 1.1);
      expect(all.filter((p) => p.status === 'open'), state).toHaveLength(1);
    });

    it('a bigger rush with cancels mixed in: every order lands, no truck goes out short or over (CI caught both)', async () => {
      const cs = [await ctx(a), await ctx(b)];
      await serviceDb().update(salt_order).set({ status: 'cancelled' }).where(sql`${salt_order.supplier_id} = ${sid} and ${salt_order.status} = 'pooling'`);
      const placed = await Promise.all(Array.from({ length: 30 }, (_, i) => placeOrder(cs[i % 2]!, { tons: 1 + (i % 5), address: `${i + 100} Main St, Lakewood, OH` })));
      // Cancel a third of them while more orders arrive.
      const cancels = placed.filter((_, i) => i % 3 === 0).map((r, i) => cancelOrder(cs[(i * 3) % 2]!, r.order!.id).catch((e: { code?: string }) => e.code));
      const more = Array.from({ length: 10 }, (_, i) => placeOrder(cs[i % 2]!, { tons: 2 + (i % 3), address: `${i + 200} Main St, Lakewood, OH` }));
      const settled = await Promise.allSettled([...cancels, ...more]);
      expect(settled.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      const all = await loads();
      const state = JSON.stringify(all.map((p) => ({ status: p.status, tons: sum(p.orders) })));
      // A load only goes out full, or at least SHIP_AS_IS of a truck when the next order won't fit: never short because
      // a cancel slipped in after it was counted, and never over the overfill allowance.
      for (const p of all.filter((x) => x.status === 'sent')) expect(sum(p.orders), state).toBeGreaterThanOrEqual(22 * SHIP_AS_IS - 0.01);
      for (const p of all) expect(sum(p.orders), state).toBeLessThanOrEqual(22 * (1 + OVERFILL) + 0.01);
      expect(all.filter((p) => p.status === 'open'), state).toHaveLength(1);
    });

    it('a cancel racing the load filling never leaves a cancelled order on a sent load', async () => {
      const [ca, cb] = [await ctx(a), await ctx(b)];
      for (let i = 0; i < 4; i++) {
        // Empty the open load so the arithmetic is exact: 1 of mine plus 21 of theirs fills it, 21 alone doesn't.
        await serviceDb().update(salt_order).set({ status: 'cancelled' }).where(sql`${salt_order.supplier_id} = ${sid} and ${salt_order.status} = 'pooling'`);
        const mine = await placeOrder(ca, { tons: 1, address: '1 Main St, Lakewood, OH' });
        await Promise.allSettled([cancelOrder(ca, mine.order!.id), placeOrder(cb, { tons: 21, address: '2 Main St, Lakewood, OH' })]);
        const [o] = await serviceDb().select().from(salt_order).where(eq(salt_order.id, mine.order!.id));
        const [p] = await serviceDb().select().from(salt_pool).where(eq(salt_pool.id, o!.pool_id!));
        expect([o!.status, p!.status], `round ${i}: order ${o!.status}, load ${p!.status}`).toEqual(o!.status === 'cancelled' ? ['cancelled', 'open'] : ['ordered', 'sent']);
      }
    });

    it('two quick Mark delivered taps add the salt once, and a typo is caught', async () => {
      const c = await ctx(a);
      const big = await placeOrder(c, { tons: 22, address: '1 Main St, Lakewood, OH' });
      const [sup] = await serviceDb().select().from(salt_supplier).where(eq(salt_supplier.id, sid));
      await expect(supplierUpdate(sup!, big.order!.id, { delivered_tons: 220 })).rejects.toMatchObject({ status: 422 });
      const count = async () => ((await serviceDb().execute(sql`select value from app_setting where key = ${`salt_stock:${a.tenantId}`}`)) as unknown as { value: { entries: { id: string }[] } }[])[0]?.value.entries.filter((e) => e.id === `salt-order-${big.order!.id}`).length ?? 0;
      await Promise.all([supplierUpdate(sup!, big.order!.id, { delivered_tons: 22 }), supplierUpdate(sup!, big.order!.id, { delivered_tons: 22 })]);
      expect(await count()).toBe(1);
      // A date can't be set on a delivered load.
      await expect(supplierUpdate(sup!, big.order!.id, { delivery_date: '2026-12-02' })).rejects.toMatchObject({ status: 409 });
    });

    it('a load that is not filling can be sent short of a full truck', async () => {
      const c = await ctx(a);
      const w = await placeOrder(c, { tons: 4, address: '1 Main St, Lakewood, OH' });
      const open = (await loads()).find((p) => p.status === 'open')!;
      const r = await updateSupplier(sid, { send_now: true });
      expect(r.sent).toBe(sum(open.orders));
      const [o] = await serviceDb().select().from(salt_order).where(eq(salt_order.id, w.order!.id));
      expect(o!.status).toBe('ordered');
      expect((await updateSupplier(sid, { send_now: true })).sent).toBeNull();
    });

    it('turning a supplier off cancels orders waiting on its load but lets it finish loads it already has', async () => {
      const c = await ctx(b);
      const waiting = await placeOrder(c, { tons: 2, address: '2 Main St, Lakewood, OH' });
      expect(waiting.order!.status).toBe('pooling');
      const off = await updateSupplier(sid, { active: false });
      const [o] = await serviceDb().select().from(salt_order).where(eq(salt_order.id, waiting.order!.id));
      expect(o!.status).toBe('cancelled');
      expect((await loads()).filter((p) => p.status === 'open')).toHaveLength(0);
      const token = off.link.split('/supplier/')[1]!;
      expect(await resolveSupplier(token)).not.toBeNull();
      const renewed = await updateSupplier(sid, { new_link: true });
      expect(await resolveSupplier(token)).toBeNull();
      expect(await resolveSupplier(renewed.link.split('/supplier/')[1]!)).not.toBeNull();
    });
  });
});

