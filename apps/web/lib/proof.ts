import { and, asc, contract, crew_member, customer, desc, eq, gte, inArray, lte, message_log, problem_report, proof_packet, run_stop, serviceDb, site, site_walk_item, sql, storm, storm_run, tenant, truck, visit, visit_correction, visit_photo, weather_snapshot } from '@flake/db';
import { distanceMeters, distanceToPolygonMeters } from '@flake/core/geo';
import { usDistanceText } from '@flake/core/units';
import type { MultiPolygon, Polygon } from 'geojson';
import { contractsInForce, currentSeason } from '@flake/core/time';
import { photoOrder } from '@flake/core/proof';
import { buildManifest, type ProofInput, type ProofSnapshot, type ProofVisit } from '@flake/core/proof';
import { getBlob, putBlob } from './blob';
import { stationHistory } from './weather';
import { sha256Hex } from './tokens';

/** Only this site's value survives from a shared NOHRSC row, and the hourly detail stays out of the packet. */
function snapshotForPacket(s: typeof weather_snapshot.$inferSelect, siteId: string): ProofSnapshot {
  const { hourly: _hourly, sites, ...rest } = s.summary;
  const summary: Record<string, unknown> = { ...rest };
  if (s.source === 'nohrsc') summary.sites = { [siteId]: sites?.[siteId] ?? null };
  return { id: s.id, source: s.source, request_url: s.request_url, fetched_at: s.fetched_at, last_modified: s.last_modified, sha256: s.sha256, summary };
}

/** Assembles the same input for the same records, so the manifest hash is reproducible. */
export async function assembleProof(tenantId: string, siteId: string, from: string, to: string, incidentAt?: string): Promise<ProofInput> {
  const db = serviceDb();
  const [row] = await db.select({ site, customer, tenant }).from(site).innerJoin(customer, eq(customer.id, site.customer_id)).innerJoin(tenant, eq(tenant.id, site.tenant_id)).where(and(eq(site.id, siteId), eq(site.tenant_id, tenantId)));
  if (!row) throw new Error('Site not found for tenant');
  // The agreement in force during the period (issue 109), not whatever was signed last: a packet for a December claim
  // shows December's terms even after a January re-signature or next winter's renewal. Taken at the window's middle,
  // which for a claim-date packet is the claim date.
  const middle = new Date((Date.parse(from) + Date.parse(to)) / 2);
  const signed = await db.select().from(contract).where(and(eq(contract.tenant_id, tenantId), eq(contract.site_id, siteId), inArray(contract.status, ['accepted', 'void']))).orderBy(desc(contract.created_at));
  const [c] = contractsInForce(signed, middle, row.tenant.timezone);
  const visits = await db.select({ visit, crew: crew_member }).from(visit).innerJoin(crew_member, eq(crew_member.id, visit.crew_id)).where(and(eq(visit.tenant_id, tenantId), eq(visit.site_id, siteId), gte(visit.arrived_device_at, from), lte(visit.arrived_device_at, to))).orderBy(asc(visit.arrived_device_at));
  const visitIds = visits.map((v) => v.visit.id);
  const photos = visitIds.length ? await db.select().from(visit_photo).where(and(eq(visit_photo.tenant_id, tenantId), inArray(visit_photo.visit_id, visitIds))) : [];
  const corrections = visitIds.length ? await db.select().from(visit_correction).where(and(eq(visit_correction.tenant_id, tenantId), inArray(visit_correction.visit_id, visitIds))).orderBy(asc(visit_correction.created_at)) : [];

  // Storms in the period that this lot was on (a stop on one of its routes), or that hold one of its visits. Another
  // lot's storm, or one from before this lot existed, isn't evidence for this one (issue 145).
  const stormIds = [...new Set(visits.map((v) => v.visit.storm_id))];
  const onLot = sql`exists (select 1 from run_stop rs join storm_run r on r.id = rs.storm_run_id where r.storm_id = ${storm.id} and rs.site_id = ${siteId})`;
  const storms = await db.select().from(storm).where(and(eq(storm.tenant_id, tenantId), sql`((${storm.started_at} <= ${to} and coalesce(${storm.closed_at}, ${storm.started_at}) >= ${from} and ${onLot}) ${stormIds.length ? sql`or ${storm.id} in (${sql.join(stormIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``})`));
  const snapshotIds = [...new Set(storms.flatMap((s) => s.forecast_snapshot_ids ?? []))];
  const snapshots = snapshotIds.length ? await db.select().from(weather_snapshot).where(inArray(weather_snapshot.id, snapshotIds)) : [];
  const relevant = (s: typeof weather_snapshot.$inferSelect) => s.source !== 'nws_grid' || (s.office === row.site.nws_office && s.grid_x === row.site.nws_grid_x && s.grid_y === row.site.nws_grid_y);

  const messages = await db.select().from(message_log).where(and(eq(message_log.tenant_id, tenantId), sql`${message_log.related}->>'site_id' = ${siteId}`, gte(message_log.created_at, from), lte(message_log.created_at, to)));

  // A packet is evidence, so each visit says who entered its times and whether it was voided, in the visit row itself.
  const enteredBy = (id: string): ProofVisit['entered_by'] => {
    const notes = corrections.filter((c2) => c2.visit_id === id && c2.field === 'notes').map((c2) => c2.new_value);
    return notes.includes('Visit recorded by the office') ? 'office_recorded' : notes.includes('Done time entered by the office') ? 'office_done' : 'phone';
  };
  const voidedReason = (id: string) => corrections.filter((c2) => c2.visit_id === id && c2.field === 'voided').at(-1)?.new_value === true
    ? (corrections.filter((c2) => c2.visit_id === id && c2.field === 'voided').at(-1)!.reason ?? 'Voided') : null;
  // A phone that wasn't at the lot on arrival: how far off, the same words billing review uses (issue 152).
  const gpsNote = (v: typeof visit.$inferSelect) => {
    if (v.gps_match !== false || v.arrive_lat == null || v.arrive_lon == null) return null;
    const polygons = row.site.polygons as Polygon | MultiPolygon | null;
    const m = polygons ? distanceToPolygonMeters(v.arrive_lat, v.arrive_lon, polygons) : distanceMeters(v.arrive_lat, v.arrive_lon, row.site.lat, row.site.lon);
    return `Phone was about ${usDistanceText(m)} from the lot on arrival.`;
  };
  // Every agreement that priced a visit here, when a re-sign falls inside the period (issue 158).
  const agreements = [...new Map(visits.flatMap(({ visit: v }) => contractsInForce(signed, v.arrived_device_at, row.tenant.timezone).slice(0, 1)).map((k) => [k.id, k])).values()]
    .sort((a, b) => Date.parse(a.accepted_at ?? '') - Date.parse(b.accepted_at ?? ''));
  // The truck on each visit's route that storm, for "which truck was on my lot".
  const stopIds = visits.map((x) => x.visit.run_stop_id).filter((x): x is string => Boolean(x));
  const trucks = stopIds.length ? await db.select({ stop: run_stop.id, name: truck.name }).from(run_stop).innerJoin(storm_run, eq(storm_run.id, run_stop.storm_run_id)).innerJoin(truck, eq(truck.id, storm_run.truck_id)).where(and(eq(run_stop.tenant_id, tenantId), inArray(run_stop.id, stopIds))) : [];
  // The site walk for every season the period touches: what was already there before the snow.
  const seasons = [...new Set([currentSeason(new Date(from), row.tenant.timezone), currentSeason(new Date(to), row.tenant.timezone)])];
  const walk = await db.select().from(site_walk_item).where(and(eq(site_walk_item.tenant_id, tenantId), eq(site_walk_item.site_id, siteId), inArray(site_walk_item.season, seasons))).orderBy(asc(site_walk_item.created_at));
  const proofVisits: ProofVisit[] = visits.map(({ visit: v, crew }) => ({
    entered_by: enteredBy(v.id), voided_reason: voidedReason(v.id), gps_note: gpsNote(v), truck_name: trucks.find((t) => t.stop === v.run_stop_id)?.name ?? null,
    id: v.id, storm_id: v.storm_id, crew_name: crew.name, arrived_device_at: v.arrived_device_at, arrived_received_at: v.arrived_received_at, departed_device_at: v.departed_device_at, departed_received_at: v.departed_received_at,
    arrive_lat: v.arrive_lat, arrive_lon: v.arrive_lon, arrive_acc_m: v.arrive_acc_m, services: v.services, salt: v.salt, depth_in: v.depth_in === null ? null : Number(v.depth_in), is_replow: Boolean(v.is_replow), gps_match: v.gps_match,
    photos: photos.filter((p) => p.visit_id === v.id).sort(photoOrder).map((p) => ({ id: p.id, phase: p.phase ?? 'other', storage_path: p.storage_path, sha256: p.sha256, taken_device_at: p.taken_device_at, received_at: p.received_at! })),
  }));

  return {
    contractor: { name: row.tenant.name, timezone: row.tenant.timezone },
    customer: { name: row.customer.name },
    site: { id: row.site.id, label: row.site.label, address: row.site.address, lat: row.site.lat, lon: row.site.lon },
    period: { from, to },
    contract: c ? { season: c.season, services: c.services, salt_pricing: c.salt_pricing, terms_md: c.terms_md, accepted_at: c.accepted_at, accepted_name: c.accepted_name } : null,
    ...(incidentAt ? await incidentExtras(tenantId, siteId, row.site.nws_station, from, to, incidentAt) : {}),
    ...(walk.length ? { site_walk: walk.map((w) => ({ id: w.id, season: w.season, kind: w.kind, note: w.note, taken_at: w.taken_at, photo: w.photo_path ? { storage_path: w.photo_path, sha256: w.photo_sha256 } : null })) } : {}),
    ...(agreements.length > 1 ? { agreements: agreements.map((k) => ({ season: k.season, services: k.services, accepted_at: k.accepted_at, accepted_name: k.accepted_name })) } : {}),
    storms: storms.map((s) => ({ id: s.id, name: s.name, started_at: s.started_at, closed_at: s.closed_at, snapshots: snapshots.filter((x) => (s.forecast_snapshot_ids ?? []).includes(x.id) && relevant(x)).map((x) => snapshotForPacket(x, siteId)) })),
    visits: proofVisits,
    messages: messages.map((m) => ({ id: m.id, channel: m.channel!, template: m.template, body: m.body, created_at: m.created_at!, status: m.status })),
    corrections: corrections.map((c2) => ({ id: c2.id, visit_id: c2.visit_id, field: c2.field, old_value: c2.old_value, new_value: c2.new_value, reason: c2.reason, created_at: c2.created_at! })),
  };
}

/**
 * What an incident packet adds (issue 163): driver problem reports on the lot in the window, and observed weather at
 * the nearest airport station for every hour of it, storm or not, since a slip often happens the morning after.
 */
async function incidentExtras(tenantId: string, siteId: string, station: string | null, from: string, to: string, incidentAt: string): Promise<Pick<ProofInput, 'incident_at' | 'problems' | 'observations'>> {
  const db = serviceDb();
  const problems = await db.select({ p: problem_report, crew: crew_member.name }).from(problem_report).leftJoin(crew_member, eq(crew_member.id, problem_report.crew_id))
    .where(and(eq(problem_report.tenant_id, tenantId), eq(problem_report.site_id, siteId), gte(problem_report.created_at, from), lte(problem_report.created_at, to))).orderBy(asc(problem_report.created_at));
  let observations: ProofInput['observations'];
  if (station) {
    try {
      const snap = await stationHistory(station, from, to);
      if (snap) observations = { station, provider: snap.summary.provider, request_url: snap.request_url, sha256: snap.sha256, fetched_at: snap.fetched_at, rows: snap.summary.rows, ...(snap.summary.synthetic ? { synthetic: true } : {}) };
    } catch {
      // The archive didn't answer: the packet says observed weather is unavailable rather than failing.
    }
  }
  return {
    incident_at: incidentAt,
    problems: problems.map(({ p, crew }) => ({ id: p.id, kind: p.kind ?? 'other', note: p.note, crew_name: crew, at: p.created_at! })),
    ...(observations ? { observations } : {}),
  };
}

/** Thumbnails keep the PDF small. A photo the renderer can't read shows as "image unavailable". */
async function imagesFor(input: ProofInput): Promise<Record<string, Uint8Array>> {
  const sharp = (await import('sharp')).default;
  const out: Record<string, Uint8Array> = {};
  for (const w of input.site_walk ?? []) {
    if (!w.photo) continue;
    const bytes = await getBlob('photos', w.photo.storage_path);
    if (!bytes) continue;
    try {
      out[`walk:${w.id}`] = await sharp(bytes).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
    } catch {
      // Left out; the PDF prints "Image unavailable" for it.
    }
  }
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
export async function renderProof(p: { tenantId: string; siteId: string; from: string; to: string; packetId?: string; createdBy?: string | null; incidentAt?: string }) {
  const input = await assembleProof(p.tenantId, p.siteId, p.from, p.to, p.incidentAt);
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
