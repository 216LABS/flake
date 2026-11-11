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
Font.registerHyphenationCallback((word) => [word]);

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
  h1: { fontSize: 20, fontFamily: 'Noto Sans', fontWeight: 'bold', marginBottom: 6 },
  h2: { fontSize: 13, fontFamily: 'Noto Sans', fontWeight: 'bold', marginTop: 14, marginBottom: 6 },
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

function servicesText(services: unknown): string[] {
  if (!Array.isArray(services)) return [];
  return services.map((x: any) => {
    const p = x.pricing;
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const price = !p ? 'priced by unit'
      : p.type === 'per_push' ? `${money(p.amount_cents)} per push`
      : p.type === 'per_event' ? `${money(p.amount_cents)} per event`
      : p.type === 'hourly' ? `${money(p.rate_cents)} per hour`
      : p.type === 'seasonal' ? `${money(p.total_cents)} seasonal, ${p.installments} installments`
      : 'per-inch tiers';
    return `${x.service}: ${price}${x.trigger_in === 0 ? ', zero tolerance (any measurable snow)' : x.trigger_in != null ? `, trigger ${x.trigger_in}"` : ''}`;
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

function ProofDoc({ manifest: m, manifestSha256, generatedAt, images }: ProofPdfInput) {
  const tz = m.contractor.timezone;
  const when = (iso: string | null | undefined) => (iso ? fmtLocal(iso, tz, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : unavailable);
  const synthetic = m.storms.some((st) => st.snapshots.some((sn) => sn.summary.synthetic === true));
  const visitsWithPhotos = m.visits.filter((v) => v.photos.length);
  return (
    <Document title={`Proof packet - ${m.site.label}`} author="Flake by 216LABS">
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
          </View>
        ) : <Text style={s.muted}>No contract on file for this site.</Text>}

        <Text style={s.h2}>Storm timeline and weather evidence</Text>
        {m.storms.length === 0 ? <Text style={s.muted}>No storms in this period.</Text> : null}
        {m.storms.map((st) => (
          <View key={st.id} wrap>
            <Text style={s.h3}>{st.name}: {when(st.started_at)} to {when(st.closed_at)}</Text>
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
            v.crew_name,
            `Phone: ${when(v.arrived_device_at)}\nServer: ${when(v.arrived_received_at)}`,
            `Phone: ${when(v.departed_device_at)}\nServer: ${when(v.departed_received_at)}`,
            v.arrive_lat === null ? unavailable : `${v.arrive_lat.toFixed(5)}, ${v.arrive_lon?.toFixed(5)} (${val(v.arrive_acc_m, ' m')})`,
            v.services.join(', ') + (v.is_replow ? ' (re-plow)' : ''),
            Array.isArray(v.salt) && v.salt.length ? (v.salt as any[]).map((x) => `${x.qty} ${x.unit}`).join(', ') : '-',
            val(v.depth_in, '"'),
            String(v.photos.length),
          ])}
        />
      </Page>

      {/* Photos are evidence too, so the packet always says what it has, even when that's none (issue 43). */}
      {m.visits.length ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.h2}>Photos</Text>
          {!visitsWithPhotos.length ? <Text>No photos were taken on these {m.visits.length === 1 ? 'visit' : `${m.visits.length} visits`}. The times, GPS and weather above are the record.</Text> : null}
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
  saltText?: string | null;
  terms: string | null;
  acceptance?: { name: string; at: string; ip: string | null } | null;
  disclaimer?: string;
  footerCta?: string;
  serviceLines?: string[];
}

function ContractDoc(i: ContractPdfInput) {
  const lines = i.serviceLines ?? servicesText(i.services);
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
        {i.terms ? (
          <View>
            <Text style={s.h2}>Terms</Text>
            <Text>{i.terms}</Text>
          </View>
        ) : null}
        {i.acceptance ? (
          <View>
            <Text style={s.h2}>Acceptance</Text>
            <Text>Accepted electronically by {i.acceptance.name} on {i.acceptance.at} from IP {i.acceptance.ip ?? unavailable}.</Text>
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
