/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { NOTO_SANS_BOLD, NOTO_SANS_REGULAR } from './fonts/noto-sans';
import type { ProofManifest } from '@flake/core/proof';
import { fmtLocal } from '@flake/core/time';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ReactElement } from 'react';

// The built-in PDF fonts only cover Western European letters: "Nguyễn" or "Łódź" came out garbled, and an emoji
// cut the rest of the line off. Noto Sans covers every Latin script plus Greek and Cyrillic.
Font.register({ family: 'Noto Sans', fonts: [{ src: NOTO_SANS_REGULAR }, { src: NOTO_SANS_BOLD, fontWeight: 'bold' }] });
// No hyphens in ordinary words, but a run of letters longer than a line (a 200-character lot label, a typed signer
// name) breaks into pieces instead of running off the page (issue 158).
Font.registerHyphenationCallback((word) => (word.length > 40 ? word.match(/.{1,30}/gu) ?? [word] : [word]));

const WALK_KIND: Record<string, string> = { damage: 'Damage already there', pile: 'Where piles go', hazard: 'Hazard', drain: 'Drain or grate', note: 'Note' };

/** A service as the customer reads it, "Plow" and not the stored "plow" (issue 145). */
const SERVICE_WORD: Record<string, string> = { plow: 'Plow', salt: 'Salt', walks: 'Walks', haul: 'Haul' };
const serviceWord = (s: string) => SERVICE_WORD[s] ?? s;

/** Letters Noto Sans has: Latin (with Vietnamese), IPA, accents, Greek, Cyrillic, and common punctuation and symbols. */
const COVERED = /[^\t\n\r\u0020-\u052F\u1E00-\u1FFF\u2000-\u206F\u20A0-\u20CF\u2100-\u22FF]/gu;

/**
 * Emoji are dropped and other letters the font lacks (Chinese, Arabic) become "?", so the rest of the line still
 * prints. Only the picture changes: the manifest and its hash are computed from the real text before this.
 */
export function pdfSafe<T>(value: T): T {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, '').replace(COVERED, '?') as T;
  if (Array.isArray(value)) return value.map(pdfSafe) as T;
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pdfSafe(v)])) as T;
  return value;
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Noto Sans', color: '#111827', lineHeight: 1.35 },
  // Headings set their own line height: the page's is sized for 10 pt text, which let a 20 pt title overlap the next line.
  h1: { fontSize: 20, fontFamily: 'Noto Sans', fontWeight: 'bold', marginBottom: 8, lineHeight: 1.25 },
  h2: { fontSize: 13, fontFamily: 'Noto Sans', fontWeight: 'bold', marginTop: 14, marginBottom: 6, lineHeight: 1.25 },
  h3: { fontSize: 10.5, fontFamily: 'Noto Sans', fontWeight: 'bold', marginTop: 8, marginBottom: 3 },
  muted: { color: '#4b5563' },
  mono: { fontFamily: 'Courier', fontSize: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#d1d5db', paddingVertical: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#111827', paddingBottom: 3, fontFamily: 'Noto Sans', fontWeight: 'bold' },
  cell: { flex: 1, paddingRight: 4, fontSize: 8 },
  warn: { backgroundColor: '#fef3c7', padding: 6, marginBottom: 8 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photo: { width: 240, marginBottom: 8 },
  img: { width: 240, height: 180, objectFit: 'contain', backgroundColor: '#f3f4f6' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7, color: '#6b7280', textAlign: 'center' },
});

const unavailable = 'unavailable';
const val = (v: unknown, suffix = '') => (v === null || v === undefined ? unavailable : `${v}${suffix}`);

function Table({ cols, rows, widths }: { cols: string[]; rows: string[][]; widths?: number[] }) {
  return (
    <View>
      <View style={s.head} fixed>
        {cols.map((c, j) => <Text key={c} style={[s.cell, { flex: widths?.[j] ?? 1 }]}>{c}</Text>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          {r.map((c, j) => <Text key={j} style={[s.cell, { flex: widths?.[j] ?? 1 }]}>{c}</Text>)}
        </View>
      ))}
    </View>
  );
}

/** Seasonal installments billed under an earlier agreement for the same lot and season (issue 156). */
export interface PdfPriorBilled { cents: number; count: number }

function seasonalText(p: { total_cents: number; installments: number }, prior?: PdfPriorBilled | null): string {
  const money = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
  if (!prior || (prior.cents <= 0 && prior.count <= 0)) return `${money(p.total_cents)} for the season, in ${p.installments} monthly installments`;
  const left = Math.max(0, p.total_cents - prior.cents);
  const n = Math.max(1, p.installments - prior.count);
  const head = `${money(p.total_cents)} for the season, ${money(prior.cents)} already billed under the earlier agreement`;
  if (!left) return `${head}, so nothing more is billed this season`;
  return `${head}; the remaining ${money(left)} in ${n === 1 ? 'one installment' : `${n} monthly installments`}`;
}

function servicesText(services: unknown, prior?: PdfPriorBilled | null): string[] {
  if (!Array.isArray(services)) return [];
  return services.map((x: any) => {
    const p = x.pricing;
    const money = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
    const price = !p ? 'priced by unit'
      : p.type === 'per_push' ? `${money(p.amount_cents)} per push`
      : p.type === 'per_event' ? `${money(p.amount_cents)} per event`
      : p.type === 'hourly' ? `${money(p.rate_cents)} per hour`
      : p.type === 'seasonal' ? seasonalText(p, prior)
      : 'per-inch tiers';
    return `${serviceWord(x.service)}: ${price}${x.trigger_in === 0 ? ', zero tolerance (any measurable snow)' : x.trigger_in != null ? `, trigger ${x.trigger_in}"` : ''}`;
  });
}

/**
 * react-pdf's page-number callbacks print nothing on short documents and crash once one runs past about 15
 * pages (a season of storms), so the page line is stamped onto the finished file instead.
 */
async function stampPages(pdf: Buffer, text: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const line = `${text} - page ${i + 1} of ${pages.length}`;
    page.drawText(line, { x: (page.getWidth() - font.widthOfTextAtSize(line, 7)) / 2, y: 20, size: 7, font, color: rgb(0.42, 0.45, 0.5) });
  });
  return Buffer.from(await doc.save());
}

export interface ProofPdfInput {
  manifest: ProofManifest;
  manifestSha256: string;
  generatedAt: string;
  /** Photo id to JPEG or PNG bytes. A missing entry renders as "image unavailable". */
  images: Record<string, Uint8Array>;
}

/**
 * The incident cover page's facts (issue 163), worked out from the manifest so they always match the visit rows: the
 * last service before the incident and the next after, and every freeze between the last service and the incident.
 */
export function incidentFacts(m: ProofManifest) {
  const at = Date.parse(m.incident_at!);
  const done = m.visits.filter((v) => !v.voided_reason);
  const before = done.filter((v) => Date.parse(v.arrived_device_at) <= at).at(-1) ?? null;
  const after = done.find((v) => Date.parse(v.arrived_device_at) > at) ?? null;
  const since = before ? Date.parse(before.departed_device_at ?? before.arrived_device_at) : Date.parse(m.period.from);
  const rows = (m.observations?.rows ?? []).filter((r) => r.temp_f !== null);
  const freezes = rows.filter((r, i) => i > 0 && rows[i - 1]!.temp_f! > 32 && r.temp_f! <= 32 && Date.parse(r.t) > since && Date.parse(r.t) <= at).map((r) => r.t);
  const last24 = rows.filter((r) => Date.parse(r.t) <= at && Date.parse(r.t) > at - 86_400_000).map((r) => r.temp_f!);
  const precip = (m.observations?.rows ?? []).filter((r) => Date.parse(r.t) > since && Date.parse(r.t) <= at && (r.precip_in ?? 0) > 0);
  return { before, after, freezes, low: last24.length ? Math.min(...last24) : null, high: last24.length ? Math.max(...last24) : null, precipIn: Math.round(precip.reduce((n, r) => n + (r.precip_in ?? 0), 0) * 100) / 100, wx: [...new Set(precip.map((r) => r.wx).filter(Boolean))] as string[] };
}

const hoursBetween = (a: string, b: number) => Math.round((b - Date.parse(a)) / 360_000) / 10;

function ProofDoc({ manifest: m, manifestSha256, generatedAt, images }: ProofPdfInput) {
  const tz = m.contractor.timezone;
  const when = (iso: string | null | undefined) => (iso ? fmtLocal(iso, tz, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : unavailable);
  const synthetic = m.storms.some((st) => st.snapshots.some((sn) => sn.summary.synthetic === true));
  const visitsWithPhotos = m.visits.filter((v) => v.photos.length);
  return (
    <Document title={`Proof packet - ${m.site.label}`} author="Flake by 216LABS">
      {m.incident_at ? (() => {
        const f = incidentFacts(m);
        const at = Date.parse(m.incident_at);
        const visitLine = (v: NonNullable<typeof f.before>) => `${v.services.map(serviceWord).join(' + ') || 'Visit'}: arrived ${when(v.arrived_device_at)}${v.departed_device_at ? `, left ${when(v.departed_device_at)}` : ''}${Array.isArray(v.salt) && v.salt.length ? `, salt ${(v.salt as { qty: number; unit: string }[]).map((x) => `${x.qty} ${x.unit}`).join(', ')}` : ''}. ${v.crew_name}${v.truck_name ? `, ${v.truck_name}` : ''}.`;
        return (
          <Page size="LETTER" style={s.page}>
            <Text style={s.h2}>{m.contractor.name}</Text>
            <Text style={s.h1}>Incident summary</Text>
            {m.observations?.synthetic ? <Text style={s.warn}>This packet contains SYNTHETIC weather test data from demo mode. It is not a real observation.</Text> : null}
            <Text>Site: {m.site.label}, {m.site.address}</Text>
            <Text>Customer: {m.customer.name}</Text>
            <Text>Incident reported for: {when(m.incident_at)}</Text>
            <Text style={s.h3}>Last service before the incident</Text>
            <Text>{f.before ? `${visitLine(f.before)} That was ${hoursBetween(f.before.departed_device_at ?? f.before.arrived_device_at, at)} hours before the incident.` : 'No service recorded in this window before the incident.'}</Text>
            <Text style={s.h3}>Next service after</Text>
            <Text>{f.after ? visitLine(f.after) : 'No service recorded in this window after the incident.'}</Text>
            <Text style={s.h3}>Weather</Text>
            {m.observations ? (
              <View>
                <Text>{`At ${m.observations.station}, the 24 hours before the incident ran from ${f.low ?? unavailable} F to ${f.high ?? unavailable} F.`}</Text>
                <Text>{f.freezes.length ? `The temperature fell to freezing ${f.freezes.length === 1 ? 'once' : `${f.freezes.length} times`} after the last service and before the incident: ${f.freezes.map((t) => when(t)).join('; ')}.` : 'The temperature did not fall through freezing between the last service and the incident.'}</Text>
                <Text>{f.precipIn ? `${f.precipIn} in of precipitation fell in that time${f.wx.length ? ` (reported as ${f.wx.join(', ')})` : ''}.` : 'No precipitation was reported in that time.'}</Text>
              </View>
            ) : <Text style={s.muted}>Observed station weather is unavailable for this lot.</Text>}
            <Text style={s.h3}>What the contract covers</Text>
            {m.contract ? servicesText(m.contract.services).map((line) => <Text key={line}>{line}</Text>) : <Text style={s.muted}>No contract on file for this site.</Text>}
            {m.problems?.length ? <Text style={{ marginTop: 6 }}>{m.problems.length} problem report{m.problems.length === 1 ? '' : 's'} from the crew on this lot in the window, listed with the weather.</Text> : null}
            <Text style={[s.muted, { marginTop: 12 }]}>Times are {m.contractor.name}&apos;s local time. Every fact here comes from the records that follow: visits as the phone recorded them, corrections listed separately, and weather with its source and hash.</Text>
          </Page>
        );
      })() : null}
      <Page size="LETTER" style={s.page}>
        <Text style={s.h2}>{m.contractor.name}</Text>
        <Text style={s.h1}>Proof of service packet</Text>
        {synthetic ? <Text style={s.warn}>This packet contains SYNTHETIC weather test data from demo mode. It is not a real forecast or observation.</Text> : null}
        <Text>Site: {m.site.label}</Text>
        <Text>Address: {m.site.address}</Text>
        <Text>Customer: {m.customer.name}</Text>
        <Text>Contractor: {m.contractor.name}</Text>
        <Text>Period: {when(m.period.from)} to {when(m.period.to)}</Text>
        <Text>Generated: {when(generatedAt)}</Text>
        <Text style={s.h3}>Manifest SHA-256</Text>
        <Text style={s.mono}>{manifestSha256}</Text>

        <Text style={s.h2}>Contract scope and trigger</Text>
        {m.contract ? (
          <View>
            <Text>Season: {m.contract.season}</Text>
            {servicesText(m.contract.services).map((line) => <Text key={line}>{line}</Text>)}
            <Text>Accepted: {m.contract.accepted_at ? `${when(m.contract.accepted_at)} by ${m.contract.accepted_name ?? unavailable}` : 'not accepted in Flake'}</Text>
            {m.agreements?.length ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.h3}>Agreements in force during this period</Text>
                {m.agreements.map((a, n) => (
                  <View key={`${a.season}-${a.accepted_at}`} style={{ marginBottom: 4 }}>
                    <Text>{a.season}, signed {a.accepted_at ? when(a.accepted_at) : unavailable}{a.accepted_name ? ` by ${a.accepted_name}` : ''}{m.agreements![n + 1]?.accepted_at ? `, until ${when(m.agreements![n + 1]!.accepted_at)}` : ''}:</Text>
                    {servicesText(a.services).map((line) => <Text key={line}>  {line}</Text>)}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : <Text style={s.muted}>No contract on file for this site.</Text>}

        <Text style={s.h2}>Storm timeline and weather evidence</Text>
        {m.storms.length === 0 ? <Text style={s.muted}>No storms in this period.</Text> : null}
        {m.storms.map((st) => (
          <View key={st.id} wrap>
            <Text style={s.h3}>{st.name}: {when(st.started_at)} to {when(st.closed_at)}</Text>
            {st.salt_policy ? <Text style={{ marginBottom: 4 }}>{st.salt_policy}</Text> : null}
            {st.snapshots.length === 0 ? <Text style={s.muted}>Weather data unavailable for this storm.</Text> : null}
            {st.snapshots.map((sn) => (
              <View key={sn.id} style={{ marginBottom: 6 }} wrap={false}>
                <Text>{sn.source} fetched {when(sn.fetched_at)}{sn.last_modified ? `, source updated ${when(sn.last_modified)}` : ''}</Text>
                {sn.source === 'nws_grid' ? <Text>Forecast next 12 h: {val(sn.summary.snow_next12h_in, '"')}. Elapsed: {val(sn.summary.snow_elapsed_in, '"')}. Temp: {val(sn.summary.temp_f, ' F')}.</Text> : null}
                {sn.source === 'nohrsc' ? <Text>NOHRSC observed {val(sn.summary.hours, ' h')} at this site: {val((sn.summary.sites as any)?.[m.site.id], '"')}.</Text> : null}
                {sn.source === 'nws_alerts' ? <Text>Alerts: {((sn.summary.alerts as any[]) ?? []).map((a) => a.event).join(', ') || 'none active'}</Text> : null}
                {sn.source === 'nws_obs' ? <Text>Observed temp: {val(sn.summary.temp_f, ' F')}. {String(sn.summary.conditions ?? '')}</Text> : null}
                <Text style={s.mono}>{sn.request_url}</Text>
                <Text style={s.mono}>sha256 {sn.sha256}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={s.h2}>Visits</Text>
        <Table
          widths={[1.1, 2.2, 2.2, 1.5, 1, 0.8, 0.6, 0.6]}
          cols={['Crew', 'Arrived', 'Departed', 'GPS and accuracy', 'Services', 'Salt', 'Depth', 'Photos']}
          rows={m.visits.map((v) => [
            // Who entered the times, and a voided visit marked as such, in the row itself (not only the corrections log).
            `${v.crew_name}${v.truck_name ? `\n${v.truck_name}` : ''}${v.voided_reason ? `\nVOIDED: ${v.voided_reason}` : ''}${v.entered_by === 'office_recorded' ? '\nRecorded by the office' : v.entered_by === 'office_done' ? '\nDone entered by the office' : ''}`,
            `${v.entered_by === 'office_recorded' ? 'Office' : 'Phone'}: ${when(v.arrived_device_at)}\nServer: ${when(v.arrived_received_at)}`,
            `${v.entered_by && v.entered_by !== 'phone' ? 'Office' : 'Phone'}: ${when(v.departed_device_at)}\nServer: ${when(v.departed_received_at)}`,
            v.arrive_lat === null ? unavailable : `${v.arrive_lat.toFixed(5)}, ${v.arrive_lon?.toFixed(5)} (${val(v.arrive_acc_m, ' m')})${v.gps_note ? `\n${v.gps_note}` : ''}`,
            v.services.map(serviceWord).join(', ') + (v.is_replow ? ' (re-plow)' : ''),
            Array.isArray(v.salt) && v.salt.length ? (v.salt as any[]).map((x) => `${x.qty} ${x.unit}`).join(', ') : '-',
            val(v.depth_in, '"'),
            String(v.photos.length),
          ])}
        />
      </Page>

      {m.incident_at && (m.observations || m.problems?.length) ? (
        <Page size="LETTER" style={s.page}>
          {m.problems?.length ? (
            <View>
              <Text style={s.h2}>Problem reports from the crew</Text>
              {m.problems.map((p) => <Text key={p.id}>{when(p.at)}: {p.kind}{p.crew_name ? ` (${p.crew_name})` : ''}{p.note ? `. "${p.note}"` : ''}</Text>)}
            </View>
          ) : null}
          {m.observations ? (
            <View>
              <Text style={s.h2}>Observed weather at {m.observations.station}</Text>
              {m.observations.synthetic ? <Text style={s.warn}>SYNTHETIC weather test data from demo mode. It is not a real observation.</Text> : null}
              <Text style={s.muted}>{m.observations.provider}. Fetched {when(m.observations.fetched_at)}.</Text>
              <Text style={s.mono}>{m.observations.request_url}</Text>
              <Text style={s.mono}>sha256 {m.observations.sha256}</Text>
              <Table
                widths={[2.4, 1, 1, 1.6, 1.2]}
                cols={['Time', 'Temp F', 'Precip in', 'Weather', 'Snow depth in']}
                rows={m.observations.rows.map((r, i, all) => [
                  `${when(r.t)}${i > 0 && all[i - 1]!.temp_f !== null && r.temp_f !== null && all[i - 1]!.temp_f! > 32 && r.temp_f <= 32 ? '  FREEZE' : ''}`,
                  r.temp_f === null ? '-' : String(r.temp_f), r.precip_in === null ? '-' : String(r.precip_in), r.wx ?? '-', r.snow_depth_in === null ? '-' : String(r.snow_depth_in),
                ])}
              />
            </View>
          ) : null}
        </Page>
      ) : null}

      {m.site_walk?.length ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.h2}>Pre-season site walk</Text>
          <Text style={s.muted}>Recorded by {m.contractor.name} before the season, to show what was already there.</Text>
          <View style={s.photos}>
            {m.site_walk.map((w) => (
              <View key={w.id} style={s.photo} wrap={false}>
                {w.photo ? (images[`walk:${w.id}`] ? <Image style={s.img} src={{ data: Buffer.from(images[`walk:${w.id}`]!), format: 'jpg' }} /> : <Text style={s.muted}>Image unavailable</Text>) : null}
                <Text>{WALK_KIND[w.kind] ?? w.kind}{w.note ? `: ${w.note}` : ''}</Text>
                <Text style={s.muted}>Season {w.season}{w.taken_at ? `, ${when(w.taken_at)}` : ''}</Text>
                {w.photo?.sha256 ? <Text style={s.mono}>sha256 {w.photo.sha256}</Text> : null}
              </View>
            ))}
          </View>
        </Page>
      ) : null}

      {/* Photos are evidence too, so the packet always says what it has, even when that's none (issue 43). */}
      {m.visits.length ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.h2}>Photos</Text>
          {!visitsWithPhotos.length ? <Text>No photos were taken on {m.visits.length === 1 ? 'this visit' : `these ${m.visits.length} visits`}. The times, GPS and weather above are the record.</Text> : null}
          {visitsWithPhotos.length && visitsWithPhotos.length < m.visits.length ? <Text style={s.muted}>{m.visits.length - visitsWithPhotos.length} of {m.visits.length} visits have no photos.</Text> : null}
          {visitsWithPhotos.map((v) => (
            <View key={v.id} wrap={false}>
              <Text style={s.h3}>{when(v.arrived_device_at)} - {v.crew_name}</Text>
              <View style={s.photos}>
                {v.photos.map((p) => (
                  <View key={p.id} style={s.photo}>
                    {images[p.id] ? <Image style={s.img} src={{ data: Buffer.from(images[p.id]!), format: 'jpg' }} /> : <Text style={s.muted}>Image unavailable</Text>}
                    <Text>{p.phase}: taken {when(p.taken_device_at)}, received {when(p.received_at)}</Text>
                    <Text style={s.mono}>sha256 {p.sha256}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </Page>
      ) : null}

      <Page size="LETTER" style={s.page}>
        <Text style={s.h2}>Customer messages sent</Text>
        {m.messages.length ? (
          <Table cols={['Sent', 'Channel', 'Template', 'Body']} rows={m.messages.map((x) => [when(x.created_at), x.channel, x.template, x.body])} />
        ) : <Text style={s.muted}>No customer messages in this period.</Text>}
        <Text style={s.h2}>Corrections log</Text>
        {m.corrections.length ? (
          <Table cols={['When', 'Visit', 'Field', 'Old', 'New', 'Reason']} rows={m.corrections.map((c) => [when(c.created_at), c.visit_id.slice(0, 8), c.field, JSON.stringify(c.old_value ?? null), JSON.stringify(c.new_value ?? null), c.reason])} />
        ) : <Text style={s.muted}>No corrections. Original records were not changed.</Text>}
        <Text style={s.h2}>Appendix: data sources</Text>
        <Text>{m.caveat}</Text>
        <Text style={{ marginTop: 4 }}>Visit records are append-only. Device time comes from the driver's phone and received time from the server. Corrections are separate rows that reference the original and never overwrite it. The manifest hash covers every value in this packet except the generated-at time, so regenerating from the same records yields the same hash.</Text>
      </Page>
    </Document>
  );
}

export async function renderProofPdf(input: ProofPdfInput): Promise<Buffer> {
  const pdf = await renderToBuffer(<ProofDoc {...input} manifest={pdfSafe(input.manifest)} /> as ReactElement<any>);
  return stampPages(pdf, `Flake proof packet ${input.manifestSha256.slice(0, 16)}`);
}

export interface ContractPdfInput {
  company: string;
  customer: string;
  site: string;
  season: string;
  services: unknown;
  /** Set on a mid-season re-sign, so the PDF states what is left to bill. */
  prior?: PdfPriorBilled | null;
  saltText?: string | null;
  /** How the client pays, in a sentence. */
  payment?: string | null;
  terms: string | null;
  acceptance?: { name: string; at: string; ip: string | null } | null;
  /** The company's time zone, for the acceptance time (issue 145). UTC when missing. */
  timezone?: string;
  disclaimer?: string;
  footerCta?: string;
  serviceLines?: string[];
}

function ContractDoc(i: ContractPdfInput) {
  const lines = i.serviceLines ?? servicesText(i.services, i.prior);
  return (
    <Document title={`Snow removal contract - ${i.site}`} author={i.company}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Snow removal agreement</Text>
        <Text>Contractor: {i.company}</Text>
        <Text>Client: {i.customer}</Text>
        <Text>Site: {i.site}</Text>
        <Text>Season: {i.season}</Text>
        <Text style={s.h2}>Services and pricing</Text>
        {lines.map((l) => <Text key={l}>{l}</Text>)}
        {i.saltText ? <Text>{i.saltText}</Text> : null}
        {i.payment ? <Text>Payment: {i.payment}</Text> : null}
        {i.terms ? (
          <View>
            <Text style={s.h2}>Terms</Text>
            <Text>{i.terms}</Text>
          </View>
        ) : null}
        {i.acceptance ? (
          <View>
            <Text style={s.h2}>Acceptance</Text>
            <Text>Accepted electronically by {i.acceptance.name} on {fmtLocal(i.acceptance.at, i.timezone ?? 'UTC', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} from IP {i.acceptance.ip ?? unavailable}.</Text>
          </View>
        ) : (
          <View style={{ marginTop: 30 }}>
            <Text>Client signature: ______________________________   Date: ____________</Text>
            <Text style={{ marginTop: 18 }}>Contractor signature: __________________________   Date: ____________</Text>
          </View>
        )}
        {i.disclaimer ? <Text style={[s.muted, { marginTop: 18 }]}>{i.disclaimer}</Text> : null}
        {i.footerCta ? <Text style={s.footer} fixed>{i.footerCta}</Text> : null}
      </Page>
    </Document>
  );
}

export async function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  return renderToBuffer(<ContractDoc {...pdfSafe(input)} /> as ReactElement<any>);
}

export interface InvoicePdfInput {
  company: { name: string; address?: string | null; phone?: string | null; email?: string | null; logo?: { data: Uint8Array; format: 'png' | 'jpg' } | null };
  customer: { name: string };
  /** A short number the customer can write on a check. */
  number: string;
  issuedAt: string;
  timezone: string;
  storm: string;
  lines: { description: string; quantity: number; amount_cents: number }[];
  totalCents: number;
  /** "Paid", "Due on receipt", "Due within 30 days" and so on. */
  terms: string;
  payInstructions?: string | null;
  payLink?: string | null;
  /** The free templates (issue 237): an estimate reads Estimate, with its own closing line; a footer line for the CTA. */
  kind?: 'invoice' | 'estimate';
  footer?: string | null;
}

/** A printable bill for a customer who pays by check (issue 146): number, lines, total, terms and how to pay. */
function InvoiceDoc(i: InvoicePdfInput) {
  const money = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Document title={`${i.kind === 'estimate' ? 'Estimate' : 'Invoice'} ${i.number} - ${i.company.name}`} author={i.company.name}>
      <Page size="LETTER" style={s.page}>
        {i.company.logo ? <Image style={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain', marginBottom: 6 }} src={{ data: Buffer.from(i.company.logo.data), format: i.company.logo.format }} /> : null}
        <Text style={s.h2}>{i.company.name}</Text>
        {i.company.address ? <Text>{i.company.address}</Text> : null}
        {[i.company.phone, i.company.email].filter(Boolean).length ? <Text>{[i.company.phone, i.company.email].filter(Boolean).join(' | ')}</Text> : null}
        <Text style={s.h1}>{i.kind === 'estimate' ? 'Estimate' : 'Invoice'} {i.number}</Text>
        <Text>{i.kind === 'estimate' ? 'Prepared for' : 'Bill to'}: {i.customer.name}</Text>
        <Text>Date: {fmtLocal(i.issuedAt, i.timezone, { year: 'numeric', month: 'short', day: 'numeric' })}</Text>
        <Text>For: snow service, {i.storm}</Text>
        <Text style={s.h2}>Services</Text>
        <Table widths={[5, 1, 1.4]} cols={['Description', 'Qty', 'Amount']} rows={i.lines.map((l) => [l.description, String(l.quantity), money(l.amount_cents)])} />
        <Text style={[s.h2, { textAlign: 'right' }]}>Total: {money(i.totalCents)}</Text>
        <Text style={{ textAlign: 'right' }}>{i.terms}</Text>
        {i.payInstructions ? (
          <View style={{ marginTop: 12 }}>
            <Text style={s.h3}>How to pay</Text>
            <Text>{i.payInstructions}</Text>
          </View>
        ) : null}
        {i.payLink ? <Text style={{ marginTop: 8 }}>Pay online: {i.payLink}</Text> : null}
        <Text style={[s.muted, { marginTop: 18 }]}>{i.kind === 'estimate' ? 'Prices are per service visit unless noted, and good for 30 days. Thank you for considering us.' : `Please write invoice ${i.number} on your check. Thank you for your business.`}</Text>
        {i.footer ? <Text style={[s.muted, { marginTop: 8 }]}>{i.footer}</Text> : null}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc {...pdfSafe(input)} /> as ReactElement<any>);
}

/**
 * A printable snow plow log sheet (issue 237): one row per visit, built around SIMA's documentation checklist: date,
 * arrive and leave, depth, service, salt, weather and the driver's initials. Blank rows to fill in by hand.
 */
export interface LogSheetPdfInput { company: string; site: string; season: string; rows: number; footer?: string | null }
function LogSheetDoc(i: LogSheetPdfInput) {
  const cols = ['Date', 'Arrive', 'Leave', 'Snow (in)', 'Service', 'Salt', 'Weather', 'Initials'];
  return (
    <Document title={`Snow plow log - ${i.site}`} author={i.company || 'Flake'}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Snow plow service log</Text>
        <Text>{[i.company && `Contractor: ${i.company}`, i.site && `Site: ${i.site}`, i.season && `Season: ${i.season}`].filter(Boolean).join('    ')}</Text>
        <Text style={[s.muted, { marginTop: 4, marginBottom: 8 }]}>One line per visit. Write the time you arrived and left, the snow depth you measured, what you did (plow, salt, walks), how much salt, the weather, and your initials. Keep photos with the date.</Text>
        <Table widths={[1.2, 1, 1, 1, 1.6, 1.2, 1.8, 0.9]} cols={cols} rows={Array.from({ length: i.rows }, () => cols.map(() => ' '))} />
        {i.footer ? <Text style={[s.muted, { marginTop: 8 }]}>{i.footer}</Text> : null}
      </Page>
    </Document>
  );
}

export async function renderLogSheetPdf(input: LogSheetPdfInput): Promise<Buffer> {
  return renderToBuffer(<LogSheetDoc {...pdfSafe(input)} /> as ReactElement<any>);
}

/** The insurance renewal pack (issue 236): documentation stats across the whole book, then a table per site. */
export interface RenewalPackPdfInput {
  company: string; from: string; to: string; generatedAt: string;
  facts: [string, string][];
  sites: { customer: string; site: string; visits: number; gps: number; photos: number; depth: number; salt_tons: number }[];
  coi: string | null;
  claims: string | null;
}
function RenewalDoc(i: RenewalPackPdfInput) {
  return (
    <Document title={`Insurance renewal pack - ${i.company}`} author={i.company}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Snow service documentation</Text>
        <Text>{i.company}, {i.from} to {i.to}</Text>
        <Text style={[s.muted, { marginBottom: 8 }]}>Made {i.generatedAt} from the visit records Flake keeps: each visit's arrival and departure from the driver's phone, GPS, photos and snow depth. Voided visits are left out.</Text>
        <Table widths={[3, 1.4]} cols={['', '']} rows={i.facts.map(([a, b]) => [a, b])} />
        {i.coi ? <Text style={{ marginTop: 8 }}>Insurance on file: {i.coi}</Text> : null}
        {i.claims ? <Text style={{ marginTop: 4 }}>Claims in this period: {i.claims}</Text> : null}
        <Text style={s.h2}>By site</Text>
        <Table widths={[2.2, 2.2, 0.8, 0.8, 1, 0.8, 0.9]} cols={['Customer', 'Site', 'Visits', 'GPS', 'Photos', 'Depth', 'Salt t']} rows={i.sites.map((r) => [r.customer, r.site, String(r.visits), String(r.gps), String(r.photos), String(r.depth), String(r.salt_tons)])} />
        <Text style={[s.muted, { marginTop: 10 }]}>Photos counts visits with both a before and an after photo. A proof packet for any site and dates has every visit in full, with the weather records.</Text>
      </Page>
    </Document>
  );
}

export async function renderRenewalPackPdf(input: RenewalPackPdfInput): Promise<Buffer> {
  return renderToBuffer(<RenewalDoc {...pdfSafe(input)} /> as ReactElement<any>);
}
