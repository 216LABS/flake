import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, salt_order, salt_pool, salt_supplier, serviceDb, sql, tenant, type SaltOrderStatus } from '@flake/db';
import { orderCostCents, orderPath, pickSupplier, referralFeeCents, reorderAdvice } from '@flake/core/salt';
import { baseUrl, isTestEnv, required } from './env';
import { HttpError, isUuid } from './http';
import { enqueue } from './jobs';
import { notifyOffice, sendEmail } from './messaging';
import { getProviders } from './providers';
import { addStockEntry, period, saltReport } from './reports';
import { asUser, type OfficeContext } from './auth';

type Supplier = typeof salt_supplier.$inferSelect;
type Order = typeof salt_order.$inferSelect;

let ready: { at: number; ok: boolean } | null = null;
/** Salt ordering needs its tables. Until `supabase db push` has run on a database, the feature stays hidden. */
export async function saltOrderingReady(): Promise<boolean> {
  if (ready && Date.now() - ready.at < 30_000) return ready.ok;
  const [row] = (await serviceDb().execute(sql`select to_regclass('public.salt_order') is not null as ok`)) as unknown as { ok: boolean }[];
  ready = { at: Date.now(), ok: Boolean(row?.ok) };
  return ready.ok;
}

/** 216LABS staff who manage partner suppliers. Everyone in local and test, so tests and demos can reach it. */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (isTestEnv()) return true;
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return Boolean(email && admins.includes(email.toLowerCase()));
}

// Supplier links: id, version and signature, like the customer records page. A new link bumps the version.
const sign = (id: string, rev: number) => createHmac('sha256', required('LINK_TOKEN_SECRET')).update(`salt-supplier:${id}:${rev}`).digest('base64url').slice(0, 32);
const idToB64 = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
const b64ToId = (s: string) => {
  const hex = Buffer.from(s, 'base64url').toString('hex');
  return hex.length === 32 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : '';
};
export const supplierLink = (s: Pick<Supplier, 'id' | 'link_rev'>) => `${baseUrl()}/supplier/${idToB64(s.id)}.${s.link_rev}.${sign(s.id, s.link_rev)}`;

export async function resolveSupplier(token: string): Promise<Supplier | null> {
  const [idPart, revPart, mac] = token.split('.');
  if (!idPart || !revPart || !mac || !/^\d{1,9}$/.test(revPart)) return null;
  const id = b64ToId(idPart);
  if (!isUuid(id)) return null;
  const rev = Number(revPart);
  const want = Buffer.from(sign(id, rev));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [s] = await serviceDb().select().from(salt_supplier).where(eq(salt_supplier.id, id));
  return s && s.link_rev === rev && s.active ? s : null;
}

// ---------- Admin: partner suppliers ----------

export interface SupplierInput {
  name: string; contact_name?: string | null; email: string; phone?: string | null; address: string;
  radius_mi: number; price_per_ton_cents: number; truckload_tons: number; stop_fee_cents: number; referral_fee_per_ton_cents: number;
}

async function geocode(address: string): Promise<{ lat: number; lon: number; label: string }> {
  const { geocoder } = await getProviders();
  const [hit] = await geocoder.search(address);
  if (!hit) throw new HttpError(422, "We couldn't find that address. Check it and try again.");
  return { lat: hit.lat, lon: hit.lon, label: hit.label };
}

export async function createSupplier(input: SupplierInput) {
  const at = await geocode(input.address);
  const { address: _a, ...rest } = input;
  const [s] = await serviceDb().insert(salt_supplier).values({ ...rest, lat: at.lat, lon: at.lon }).returning();
  return { ...s!, link: supplierLink(s!) };
}

export async function updateSupplier(id: string, patch: Partial<Pick<Supplier, 'price_per_ton_cents' | 'stop_fee_cents' | 'referral_fee_per_ton_cents' | 'radius_mi' | 'truckload_tons' | 'active' | 'email' | 'phone' | 'contact_name'>> & { new_link?: boolean }) {
  const { new_link, ...set } = patch;
  const [s] = await serviceDb().update(salt_supplier).set({ ...set, ...(new_link ? { link_rev: sql`${salt_supplier.link_rev} + 1` } : {}) }).where(eq(salt_supplier.id, id)).returning();
  if (!s) throw new HttpError(404, 'Supplier not found');
  return { ...s, link: supplierLink(s) };
}

const WAITLIST_KEY = 'salt_waitlist';

/** The admin view: suppliers, what each owes 216LABS, open pools, and demand from places no supplier covers yet. */
export async function adminOverview() {
  const db = serviceDb();
  const suppliers = await db.select().from(salt_supplier).orderBy(salt_supplier.name);
  const orders = await db.select().from(salt_order);
  const pools = await db.select().from(salt_pool).where(eq(salt_pool.status, 'open'));
  const [wait] = (await db.execute(sql`select value from app_setting where key = ${WAITLIST_KEY}`)) as unknown as { value: { entries: WaitEntry[] } }[];
  return {
    suppliers: suppliers.map((s) => {
      const mine = orders.filter((o) => o.supplier_id === s.id && o.status !== 'cancelled');
      const delivered = mine.filter((o) => o.status === 'delivered');
      return {
        ...s,
        link: supplierLink(s),
        open_tons: pools.filter((p) => p.supplier_id === s.id).reduce((n, p) => n + mine.filter((o) => o.pool_id === p.id).reduce((m, o) => m + o.tons, 0), 0),
        orders: mine.length,
        delivered_tons: delivered.reduce((n, o) => n + (o.delivered_tons ?? o.tons), 0),
        fees_earned_cents: delivered.reduce((n, o) => n + referralFeeCents(o.tons, o.delivered_tons, o.referral_fee_per_ton_cents), 0),
        fees_pending_cents: mine.filter((o) => o.status !== 'delivered').reduce((n, o) => n + referralFeeCents(o.tons, null, o.referral_fee_per_ton_cents), 0),
      };
    }),
    waitlist: (wait?.value.entries ?? []).slice(-50).reverse(),
  };
}

// ---------- Contractors ----------

interface WaitEntry { at: string; tenant: string; address: string; tons: number }

export interface OrderInput { tons: number; address: string; needed_by?: string | null; contact_name?: string | null; contact_phone?: string | null; notes?: string | null }

/** What ordering here would look like: the supplier, price, and how full the current pool is. Nothing is saved. */
export async function quote(address: string, tons: number) {
  const at = await geocode(address);
  const s = pickSupplier(await serviceDb().select().from(salt_supplier).where(eq(salt_supplier.active, true)), at.lat, at.lon);
  if (!s) return { covered: false as const, address: at.label };
  const poolTons = await openPoolTons(s.id);
  const path = orderPath(tons, poolTons, s.truckload_tons);
  return {
    covered: true as const,
    address: at.label,
    supplier: s.name,
    miles: Math.round(s.miles),
    price_per_ton_cents: s.price_per_ton_cents,
    stop_fee_cents: s.stop_fee_cents,
    truckload_tons: s.truckload_tons,
    pool_tons: poolTons,
    path,
    total_cents: orderCostCents(tons, s.price_per_ton_cents, s.stop_fee_cents, path.kind === 'pool'),
  };
}

async function openPoolTons(supplierId: string): Promise<number> {
  const [row] = (await serviceDb().execute(sql`
    select coalesce(sum(o.tons), 0)::float as tons from salt_pool p join salt_order o on o.pool_id = p.id and o.status = 'pooling'
    where p.supplier_id = ${supplierId} and p.status = 'open'`)) as unknown as { tons: number }[];
  return Number(row?.tons ?? 0);
}

export async function placeOrder(ctx: OfficeContext, input: OrderInput) {
  const at = await geocode(input.address);
  const db = serviceDb();
  const s = pickSupplier(await db.select().from(salt_supplier).where(eq(salt_supplier.active, true)), at.lat, at.lon);
  if (!s) {
    // Record the demand so 216LABS knows where to sign the next supplier.
    const entry: WaitEntry = { at: new Date().toISOString(), tenant: ctx.tenant.name, address: at.label, tons: input.tons };
    await db.execute(sql`
      insert into app_setting (key, value) values (${WAITLIST_KEY}, ${JSON.stringify({ entries: [entry] })}::jsonb)
      on conflict (key) do update set value = jsonb_build_object('entries', coalesce(app_setting.value->'entries', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb)`);
    throw new HttpError(422, "No partner supplier delivers there yet. We've noted your request and will tell you when one does.", 'not_covered');
  }
  const base = {
    tenant_id: ctx.tenantId, supplier_id: s.id, tons: input.tons, address: at.label, lat: at.lat, lon: at.lon,
    needed_by: input.needed_by || null, contact_name: input.contact_name || null, contact_phone: input.contact_phone || null, notes: input.notes || null,
    price_per_ton_cents: s.price_per_ton_cents, referral_fee_per_ton_cents: s.referral_fee_per_ton_cents, created_by: ctx.userId,
  };

  const out = await db.transaction(async (tx) => {
    if (input.tons >= s.truckload_tons) {
      const [o] = await tx.insert(salt_order).values({ ...base, status: 'ordered', stop_fee_cents: 0 }).returning();
      await enqueue('salt.supplier_email', { kind: 'order', id: o!.id, tenantId: ctx.tenantId }, { dedupeKey: `salt_order:${o!.id}`, db: tx });
      return { order: o!, filled: null as string | null, poolTons: null as number | null };
    }
    // One open pool per supplier (a unique index enforces it); lock it so two orders can't both think they filled it.
    await tx.execute(sql`insert into salt_pool (supplier_id, truckload_tons) values (${s.id}, ${s.truckload_tons}) on conflict do nothing`);
    const [pool] = (await tx.execute(sql`select id, truckload_tons from salt_pool where supplier_id = ${s.id} and status = 'open' for update`)) as unknown as { id: string; truckload_tons: number }[];
    const [o] = await tx.insert(salt_order).values({ ...base, pool_id: pool!.id, status: 'pooling', stop_fee_cents: s.stop_fee_cents }).returning();
    const [{ tons } = { tons: 0 }] = (await tx.execute(sql`select coalesce(sum(tons), 0)::float as tons from salt_order where pool_id = ${pool!.id} and status = 'pooling'`)) as unknown as { tons: number }[];
    if (Number(tons) >= Number(pool!.truckload_tons)) {
      await tx.update(salt_pool).set({ status: 'sent', sent_at: new Date().toISOString() }).where(eq(salt_pool.id, pool!.id));
      await tx.update(salt_order).set({ status: 'ordered', updated_at: new Date().toISOString() }).where(and(eq(salt_order.pool_id, pool!.id), eq(salt_order.status, 'pooling')));
      await enqueue('salt.supplier_email', { kind: 'pool', id: pool!.id, tenantId: ctx.tenantId }, { dedupeKey: `salt_pool:${pool!.id}`, db: tx });
      return { order: { ...o!, status: 'ordered' as SaltOrderStatus }, filled: pool!.id, poolTons: Number(tons) };
    }
    return { order: o!, filled: null, poolTons: Number(tons) };
  });

  if (out.filled) {
    // Everyone in the load hears it's on its way to the supplier.
    const members = await db.select({ tenant_id: salt_order.tenant_id }).from(salt_order).where(eq(salt_order.pool_id, out.filled));
    for (const tid of [...new Set(members.map((m) => m.tenant_id))]) await tellTenant(tid, `Your salt load is full and has gone to ${s.name}. They'll set a delivery date.`, `salt_full:${out.filled}`);
  } else if (out.order.status === 'pooling') {
    await tellTenant(ctx.tenantId, `You're in a shared salt load with ${s.name}: ${round(out.poolTons!)} of ${round(s.truckload_tons)} tons so far. It ships when the truck is full.`, `salt_joined:${out.order.id}`);
  }
  return { order: out.order, supplier: s.name, pool_tons: out.poolTons, truckload_tons: s.truckload_tons };
}

const round = (n: number) => Math.round(n * 10) / 10;

async function tellTenant(tenantId: string, headline: string, key: string) {
  const [t] = await serviceDb().select().from(tenant).where(eq(tenant.id, tenantId));
  if (t) await notifyOffice(t, { headline, link: `${baseUrl()}/reports#salt`, key, related: { salt: true } });
}

export async function cancelOrder(ctx: OfficeContext, orderId: string) {
  if (!isUuid(orderId)) throw new HttpError(404, 'Order not found');
  const db = serviceDb();
  const [o] = await db.select().from(salt_order).where(and(eq(salt_order.id, orderId), eq(salt_order.tenant_id, ctx.tenantId)));
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status === 'pooling' || (o.status === 'ordered' && !o.pool_id)) {
    await db.update(salt_order).set({ status: 'cancelled', updated_at: new Date().toISOString() }).where(eq(salt_order.id, o.id));
    if (o.status === 'ordered') await enqueue('salt.supplier_email', { kind: 'cancel', id: o.id, tenantId: ctx.tenantId }, { dedupeKey: `salt_cancel:${o.id}` });
    return { ok: true };
  }
  throw new HttpError(409, 'The supplier already has this load. Call them to change it.', 'with_supplier');
}

/** The contractor's salt picture: what's on hand, how many storms it covers, a suggestion, and their orders. */
export async function contractorSalt(ctx: OfficeContext) {
  const p = period(new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10), undefined, ctx.tenant.timezone);
  const report = await asUser(ctx, (tx) => saltReport(tx, ctx.tenantId, p));
  const used = report.storms.filter((s) => s.tons > 0);
  const perStorm = used.length ? used.reduce((n, s) => n + s.tons, 0) / used.length : null;
  const hasStock = report.entries.length > 0;
  const orders = await serviceDb().select({ o: salt_order, supplier: salt_supplier.name, pool_status: salt_pool.status }).from(salt_order)
    .innerJoin(salt_supplier, eq(salt_supplier.id, salt_order.supplier_id))
    .leftJoin(salt_pool, eq(salt_pool.id, salt_order.pool_id))
    .where(eq(salt_order.tenant_id, ctx.tenantId)).orderBy(desc(salt_order.created_at)).limit(20);
  const poolTons = new Map<string, number>();
  for (const { o } of orders) if (o.pool_id && o.status === 'pooling' && !poolTons.has(o.pool_id)) {
    const [r] = (await serviceDb().execute(sql`select coalesce(sum(tons), 0)::float as tons from salt_order where pool_id = ${o.pool_id} and status = 'pooling'`)) as unknown as { tons: number }[];
    poolTons.set(o.pool_id, Number(r?.tons ?? 0));
  }
  return {
    on_hand_tons: hasStock ? report.stock.tons : null,
    per_storm_tons: perStorm === null ? null : round(perStorm),
    advice: reorderAdvice(hasStock ? report.stock.tons : null, perStorm),
    orders: orders.map(({ o, supplier }) => ({ ...o, supplier, pool_tons: o.pool_id ? (poolTons.get(o.pool_id) ?? null) : null })),
  };
}

// ---------- Suppliers ----------

export async function supplierView(s: Supplier) {
  const db = serviceDb();
  const orders = await db.select({ o: salt_order, company: tenant.name }).from(salt_order).innerJoin(tenant, eq(tenant.id, salt_order.tenant_id))
    .where(and(eq(salt_order.supplier_id, s.id), inArray(salt_order.status, ['pooling', 'ordered', 'scheduled', 'delivered']))).orderBy(desc(salt_order.created_at)).limit(200);
  const pools = await db.select().from(salt_pool).where(eq(salt_pool.supplier_id, s.id)).orderBy(desc(salt_pool.created_at)).limit(50);
  const row = (x: (typeof orders)[number]) => ({
    id: x.o.id, company: x.company, tons: x.o.tons, address: x.o.address, needed_by: x.o.needed_by, contact_name: x.o.contact_name, contact_phone: x.o.contact_phone,
    notes: x.o.notes, status: x.o.status, delivery_date: x.o.delivery_date, delivered_tons: x.o.delivered_tons,
    amount_cents: orderCostCents(x.o.tons, x.o.price_per_ton_cents, x.o.stop_fee_cents, Boolean(x.o.pool_id)),
  });
  return {
    supplier: { name: s.name, truckload_tons: s.truckload_tons, price_per_ton_cents: s.price_per_ton_cents, stop_fee_cents: s.stop_fee_cents },
    loads: pools.filter((p) => p.status === 'sent').map((p) => ({ id: p.id, sent_at: p.sent_at, stops: orders.filter((x) => x.o.pool_id === p.id).map(row) })),
    filling: pools.filter((p) => p.status === 'open').map((p) => ({ id: p.id, tons: orders.filter((x) => x.o.pool_id === p.id && x.o.status === 'pooling').reduce((n, x) => n + x.o.tons, 0), truckload_tons: p.truckload_tons })),
    direct: orders.filter((x) => !x.o.pool_id).map(row),
  };
}

export async function supplierUpdate(s: Supplier, orderId: string, change: { delivery_date: string } | { delivered_tons: number }) {
  if (!isUuid(orderId)) throw new HttpError(404, 'Order not found');
  const db = serviceDb();
  const [o] = await db.select().from(salt_order).where(and(eq(salt_order.id, orderId), eq(salt_order.supplier_id, s.id)));
  if (!o || o.status === 'pooling' || o.status === 'cancelled') throw new HttpError(404, 'Order not found');
  const now = new Date().toISOString();
  if ('delivery_date' in change) {
    if (o.status === 'delivered') throw new HttpError(409, 'Already delivered');
    await db.update(salt_order).set({ status: 'scheduled', delivery_date: change.delivery_date, updated_at: now }).where(eq(salt_order.id, o.id));
    await tellTenant(o.tenant_id, `${s.name} will deliver your ${round(o.tons)} tons of salt on ${change.delivery_date}.`, `salt_sched:${o.id}:${change.delivery_date}`);
  } else {
    if (o.status === 'delivered') return { ok: true };
    await db.update(salt_order).set({ status: 'delivered', delivered_tons: change.delivered_tons, delivery_date: o.delivery_date ?? now.slice(0, 10), updated_at: now }).where(eq(salt_order.id, o.id));
    // The delivery goes straight onto the contractor's salt count on the Reports page.
    await addStockEntry(o.tenant_id, { id: `salt-order-${o.id}`, kind: 'delivery', at: now, tons: change.delivered_tons, note: `Delivered by ${s.name}` });
    await tellTenant(o.tenant_id, `${s.name} delivered ${round(change.delivered_tons)} tons of salt. It's added to your salt count.`, `salt_done:${o.id}`);
  }
  return { ok: true };
}

/** Job: tell the supplier about a full load, a single truckload order, or a cancellation. */
export async function emailSupplier(p: { kind: 'pool' | 'order' | 'cancel'; id: string; tenantId: string }) {
  const db = serviceDb();
  const [t] = await db.select().from(tenant).where(eq(tenant.id, p.tenantId));
  const orders: Order[] = p.kind === 'pool'
    ? await db.select().from(salt_order).where(and(eq(salt_order.pool_id, p.id), eq(salt_order.status, 'ordered')))
    : await db.select().from(salt_order).where(eq(salt_order.id, p.id));
  if (!t || !orders.length) return;
  const [s] = await db.select().from(salt_supplier).where(eq(salt_supplier.id, orders[0]!.supplier_id));
  if (!s) return;
  const companies = new Map((await db.select({ id: tenant.id, name: tenant.name }).from(tenant).where(inArray(tenant.id, orders.map((o) => o.tenant_id)))).map((x) => [x.id, x.name]));
  const lines = orders.map((o, i) => `${i + 1}. ${companies.get(o.tenant_id) ?? 'A Flake customer'}: ${round(o.tons)} tons to ${o.address}${o.needed_by ? `, needed by ${o.needed_by}` : ''}${o.contact_name || o.contact_phone ? `. Contact ${[o.contact_name, o.contact_phone].filter(Boolean).join(' ')}` : ''}`);
  const total = round(orders.reduce((n, o) => n + o.tons, 0));
  const subject = p.kind === 'cancel' ? `Cancelled: salt order for ${companies.get(orders[0]!.tenant_id)}` : p.kind === 'pool' ? `Full load: ${total} tons, ${orders.length} stops` : `New order: ${total} tons`;
  const intro = p.kind === 'cancel' ? 'This order was cancelled before you scheduled it:' : p.kind === 'pool' ? `A shared load is full. ${orders.length} stops, ${total} tons:` : 'A new truckload order:';
  const text = `${intro}\n\n${lines.join('\n')}\n\nBill each company directly at your agreed price. Set delivery dates and mark loads delivered here: ${supplierLink(s)}\n\nFlake salt orders`;
  await sendEmail(t, { to: s.email, template: 'salt_supplier', subject, text, key: `salt_supplier:${p.kind}:${p.id}`, related: { salt_supplier_id: s.id }, fromName: 'Flake salt orders', replyTo: null });
}
