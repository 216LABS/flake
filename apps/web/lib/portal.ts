import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, app_setting, contract, customer, desc, eq, gte, inArray, invoice_draft, proof_packet, serviceDb, site, sql, storm, tenant, visit, visit_correction, visit_photo, visitNotVoided } from '@flake/db';
import { required } from './env';
import { isUuid } from './http';

/**
 * A customer's portal link: their id, a version, and a signature. Nothing is stored per link, so it needs no table.
 * Making a new link bumps the version, which turns every earlier link off.
 */
const versionKey = (customerId: string) => `portal_rev:${customerId}`;
const sign = (customerId: string, version: number) => createHmac('sha256', required('LINK_TOKEN_SECRET')).update(`portal:${customerId}:${version}`).digest('base64url').slice(0, 32);
const idToB64 = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
const b64ToId = (s: string) => {
  const hex = Buffer.from(s, 'base64url').toString('hex');
  return hex.length === 32 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : '';
};

async function currentVersion(customerId: string): Promise<number> {
  const [row] = await serviceDb().select().from(app_setting).where(eq(app_setting.key, versionKey(customerId)));
  return Number(row?.value?.v ?? 0);
}

export async function portalToken(customerId: string): Promise<string> {
  const v = await currentVersion(customerId);
  return `${idToB64(customerId)}.${v}.${sign(customerId, v)}`;
}

/** Turns off every earlier link for this customer and returns the new one. */
export async function resetPortalToken(customerId: string): Promise<string> {
  const key = versionKey(customerId);
  await serviceDb().execute(sql`
    insert into app_setting (key, value) values (${key}, '{"v":1}'::jsonb)
    on conflict (key) do update set value = jsonb_build_object('v', coalesce((app_setting.value->>'v')::int, 0) + 1)`);
  return portalToken(customerId);
}

/** The customer this token belongs to, or null for a bad, old or reset link. */
export async function resolvePortal(token: string): Promise<{ customerId: string; tenantId: string } | null> {
  const [idPart, vPart, mac] = token.split('.');
  if (!idPart || !vPart || !mac || !/^\d{1,9}$/.test(vPart)) return null;
  const customerId = b64ToId(idPart);
  if (!isUuid(customerId)) return null;
  const v = Number(vPart);
  const want = Buffer.from(sign(customerId, v));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (v !== (await currentVersion(customerId))) return null;
  const [c] = await serviceDb().select({ tenantId: customer.tenant_id }).from(customer).where(eq(customer.id, customerId));
  return c ? { customerId, tenantId: c.tenantId } : null;
}

/** How far back the portal shows visits: this season and the last, for claims that come in late. */
const HISTORY_DAYS = 550;

export async function portalData(customerId: string, tenantId: string) {
  const db = serviceDb();
  const [row] = await db.select({ c: customer, t: tenant }).from(customer).innerJoin(tenant, eq(tenant.id, customer.tenant_id)).where(and(eq(customer.id, customerId), eq(customer.tenant_id, tenantId)));
  if (!row) return null;
  const sites = await db.select().from(site).where(and(eq(site.tenant_id, tenantId), eq(site.customer_id, customerId)));
  const siteIds = sites.map((s) => s.id);
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const contracts = siteIds.length ? await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), inArray(contract.site_id, siteIds), inArray(contract.status, ['sent', 'accepted']))).orderBy(desc(contract.created_at)) : [];
  const visits = siteIds.length
    ? await db.select({ v: visit, stormName: storm.name, stormOn: sql<boolean>`${storm.status} = 'active'` }).from(visit).innerJoin(storm, eq(storm.id, visit.storm_id))
      .where(and(eq(visit.tenant_id, tenantId), inArray(visit.site_id, siteIds), gte(visit.arrived_device_at, since), visitNotVoided)).orderBy(desc(visit.arrived_device_at)).limit(400)
    : [];
  const visitIds = visits.map((x) => x.v.id);
  const photos = visitIds.length ? await db.select({ id: visit_photo.id, visit_id: visit_photo.visit_id, phase: visit_photo.phase }).from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), inArray(visit_photo.visit_id, visitIds))) : [];
  const corrections = visitIds.length ? await db.select().from(visit_correction).where(and(eq(visit_correction.tenant_id, tenantId), inArray(visit_correction.visit_id, visitIds), eq(visit_correction.field, 'salt'))).orderBy(visit_correction.created_at) : [];
  const invoices = await db.select({ d: invoice_draft, stormName: storm.name }).from(invoice_draft).innerJoin(storm, eq(storm.id, invoice_draft.storm_id))
    .where(and(eq(invoice_draft.tenant_id, tenantId), eq(invoice_draft.customer_id, customerId), inArray(invoice_draft.status, ['charged', 'sent', 'paid', 'failed']))).orderBy(desc(invoice_draft.created_at)).limit(100);
  const packets = siteIds.length ? await db.select({ id: proof_packet.id, site_id: proof_packet.site_id, from: proof_packet.from_ts, to: proof_packet.to_ts, created_at: proof_packet.created_at }).from(proof_packet).where(and(eq(proof_packet.tenant_id, tenantId), inArray(proof_packet.site_id, siteIds))).orderBy(desc(proof_packet.created_at)).limit(50) : [];
  const saltOf = (id: string, own: { unit: string; qty: number }[] | null) => (corrections.filter((c) => c.visit_id === id).pop()?.new_value as typeof own | undefined) ?? own;
  return {
    company: { name: row.t.name, phone: row.t.contact_phone, email: row.t.contact_email, timezone: row.t.timezone },
    customer: { name: row.c.name },
    sites: sites.map((s) => {
      const k = contracts.find((x) => x.site_id === s.id);
      return {
        id: s.id, label: s.label, address: s.address, active: s.active,
        contract: k ? { season: k.season, status: k.status } : null,
        visits: visits.filter((x) => x.v.site_id === s.id).map(({ v, stormName, stormOn }) => ({
          id: v.id, storm: stormName, on_site_now: !v.departed_device_at && stormOn, arrived: v.arrived_device_at, departed: v.departed_device_at, services: v.services, depth: v.depth_in === null ? null : Number(v.depth_in), salt: saltOf(v.id, v.salt), replow: Boolean(v.is_replow),
          photos: photos.filter((p) => p.visit_id === v.id && p.phase !== 'issue').map((p) => ({ id: p.id, phase: p.phase })),
        })),
        packets: packets.filter((p) => p.site_id === s.id),
      };
    }),
    invoices: invoices.map(({ d, stormName }) => ({ id: d.id, storm: stormName, total_cents: d.subtotal_cents, status: d.status, pay_link: d.status === 'sent' || d.status === 'failed' ? d.pay_link : null, created_at: d.created_at })),
  };
}

/** A photo or packet is only reachable through the portal of the customer whose site it belongs to. */
export async function portalPhotoPath(customerId: string, tenantId: string, photoId: string): Promise<string | null> {
  if (!isUuid(photoId)) return null;
  const [p] = await serviceDb().select({ path: visit_photo.storage_path, phase: visit_photo.phase }).from(visit_photo)
    .innerJoin(visit, eq(visit.id, visit_photo.visit_id)).innerJoin(site, eq(site.id, visit.site_id))
    .where(and(eq(visit_photo.id, photoId), eq(visit_photo.tenant_id, tenantId), eq(site.customer_id, customerId), visitNotVoided));
  return p && p.phase !== 'issue' ? p.path : null;
}

export async function portalPacketPath(customerId: string, tenantId: string, packetId: string): Promise<string | null> {
  if (!isUuid(packetId)) return null;
  const [p] = await serviceDb().select({ path: proof_packet.pdf_path }).from(proof_packet).innerJoin(site, eq(site.id, proof_packet.site_id))
    .where(and(eq(proof_packet.id, packetId), eq(proof_packet.tenant_id, tenantId), eq(site.customer_id, customerId)));
  return p?.path ?? null;
}
