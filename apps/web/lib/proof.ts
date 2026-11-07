import { and, asc, contract, crew_member, customer, desc, eq, gte, inArray, lte, message_log, proof_packet, serviceDb, site, sql, storm, tenant, visit, visit_correction, visit_photo, weather_snapshot } from '@flake/db';
import { buildManifest, type ProofInput, type ProofSnapshot, type ProofVisit } from '@flake/core/proof';
import { getBlob, putBlob } from './blob';
import { sha256Hex } from './tokens';

/** Only this site's value survives from a shared NOHRSC row, and the hourly detail stays out of the packet. */
function snapshotForPacket(s: typeof weather_snapshot.$inferSelect, siteId: string): ProofSnapshot {
  const { hourly: _hourly, sites, ...rest } = s.summary;
  const summary: Record<string, unknown> = { ...rest };
  if (s.source === 'nohrsc') summary.sites = { [siteId]: sites?.[siteId] ?? null };
  return { id: s.id, source: s.source, request_url: s.request_url, fetched_at: s.fetched_at, last_modified: s.last_modified, sha256: s.sha256, summary };
}

/** Assembles the same input for the same records, so the manifest hash is reproducible. */
export async function assembleProof(tenantId: string, siteId: string, from: string, to: string): Promise<ProofInput> {
  const db = serviceDb();
  const [row] = await db.select({ site, customer, tenant }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, site.tenant_id)).where(and(eq(site.id, siteId), eq(site.tenant_id, tenantId)));
  if (!row) throw new Error('Site not found for tenant');
  const [c] = await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), eq(contract.site_id, siteId), eq(contract.status, 'accepted'))).orderBy(desc(contract.created_at)).limit(1);
  const visits = await db.select({ visit, crew: crew_member }).from(visit).innerJoin(crew_member, eq(crew_member.id, visit.crew_id)).where(and(eq(visit.tenant_id, tenantId), eq(visit.site_id, siteId), gte(visit.arrived_device_at, from), lte(visit.arrived_device_at, to))).orderBy(asc(visit.arrived_device_at));
  const visitIds = visits.map((v) => v.visit.id);
  const photos = visitIds.length ? await db.select().from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), inArray(visit_photo.visit_id, visitIds))) : [];
  const corrections = visitIds.length ? await db.select().from(visit_correction).where(and(eq(visit_correction.tenant_id, tenantId), inArray(visit_correction.visit_id, visitIds))) : [];

  // Storms that overlap the period, or that hold a visit in it.
  const stormIds = [...new Set(visits.map((v) => v.visit.storm_id))];
  const storms = await db.select().from(storm).where(and(eq(storm.tenant_id, tenantId), sql`(${storm.started_at} <= ${to} and coalesce(${storm.closed_at}, ${storm.started_at}) >= ${from} ${stormIds.length ? sql`or ${storm.id} in (${sql.join(stormIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``})`));
  const snapshotIds = [...new Set(storms.flatMap((s) => s.forecast_snapshot_ids ?? []))];
  const snapshots = snapshotIds.length ? await db.select().from(weather_snapshot).where(inArray(weather_snapshot.id, snapshotIds)) : [];
  const relevant = (s: typeof weather_snapshot.$inferSelect) => s.source !== 'nws_grid' || (s.office === row.site.nws_office && s.grid_x === row.site.nws_grid_x && s.grid_y === row.site.nws_grid_y);

  const messages = await db.select().from(message_log).where(and(eq(message_log.tenant_id, tenantId), sql`${message_log.related}->>'site_id' = ${siteId}`, gte(message_log.created_at, from), lte(message_log.created_at, to)));

  const proofVisits: ProofVisit[] = visits.map(({ visit: v, crew }) => ({
    id: v.id, storm_id: v.storm_id, crew_name: crew.name, arrived_device_at: v.arrived_device_at, arrived_received_at: v.arrived_received_at, departed_device_at: v.departed_device_at, departed_received_at: v.departed_received_at,
    arrive_lat: v.arrive_lat, arrive_lon: v.arrive_lon, arrive_acc_m: v.arrive_acc_m, services: v.services, salt: v.salt, depth_in: v.depth_in === null ? null : Number(v.depth_in), is_replow: Boolean(v.is_replow), gps_match: v.gps_match,
    photos: photos.filter((p) => p.visit_id === v.id).map((p) => ({ id: p.id, phase: p.phase ?? 'other', storage_path: p.storage_path, sha256: p.sha256, taken_device_at: p.taken_device_at, received_at: p.received_at! })),
  }));

  return {
    contractor: { name: row.tenant.name, timezone: row.tenant.timezone },
    customer: { name: row.customer.name },
    site: { id: row.site.id, label: row.site.label, address: row.site.address, lat: row.site.lat, lon: row.site.lon },
    period: { from, to },
    contract: c ? { season: c.season, services: c.services, salt_pricing: c.salt_pricing, terms_md: c.terms_md, accepted_at: c.accepted_at, accepted_name: c.accepted_name } : null,
    storms: storms.map((s) => ({ id: s.id, name: s.name, started_at: s.started_at, closed_at: s.closed_at, snapshots: snapshots.filter((x) => (s.forecast_snapshot_ids ?? []).includes(x.id) && relevant(x)).map((x) => snapshotForPacket(x, siteId)) })),
    visits: proofVisits,
    messages: messages.map((m) => ({ id: m.id, channel: m.channel!, template: m.template, body: m.body, created_at: m.created_at!, status: m.status })),
    corrections: corrections.map((c2) => ({ id: c2.id, visit_id: c2.visit_id, field: c2.field, old_value: c2.old_value, new_value: c2.new_value, reason: c2.reason, created_at: c2.created_at! })),
  };
}

/** Thumbnails keep the PDF small. A photo the renderer can't read shows as "image unavailable". */
async function imagesFor(input: ProofInput): Promise<Record<string, Uint8Array>> {
  const sharp = (await import('sharp')).default;
  const out: Record<string, Uint8Array> = {};
  for (const v of input.visits) {
    for (const p of v.photos) {
      const bytes = (await getBlob('photos', `${p.storage_path}.thumb.jpg`)) ?? (await getBlob('photos', p.storage_path));
      if (!bytes) continue;
      try {
        out[p.id] = await sharp(bytes).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      } catch {
        // Left out; the PDF prints "Image unavailable" for it.
      }
    }
  }
  return out;
}

/** proof.render: manifest, then PDF, then hash, then storage. */
export async function renderProof(p: { tenantId: string; siteId: string; from: string; to: string; packetId?: string; createdBy?: string | null }) {
  const input = await assembleProof(p.tenantId, p.siteId, p.from, p.to);
  const { manifest, hash } = buildManifest(input);
  const { renderProofPdf } = await import('@flake/providers/pdf');
  const pdf = await renderProofPdf({ manifest, manifestSha256: hash, generatedAt: new Date().toISOString(), images: await imagesFor(input) });
  const id = p.packetId ?? crypto.randomUUID();
  const path = `${p.tenantId}/${id}.pdf`;
  await putBlob('proof', path, pdf, 'application/pdf', { upsert: true });
  const [row] = await serviceDb().insert(proof_packet).values({
    id, tenant_id: p.tenantId, site_id: p.siteId, from_ts: p.from, to_ts: p.to, pdf_path: path, sha256: sha256Hex(pdf), manifest, manifest_sha256: hash, created_by: p.createdBy ?? null,
  }).onConflictDoNothing().returning();
  return row ?? null;
}
