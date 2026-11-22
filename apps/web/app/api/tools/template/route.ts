import { z } from 'zod';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';

const text = (max: number) => z.string().trim().max(max);
const lines = z.array(z.object({ description: text(200).min(1), quantity: z.number().min(0).max(10_000), amount_cents: z.number().int().min(0).max(10_000_000) })).min(1).max(40);
const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('invoice'), company: text(200).min(1), customer: text(200).min(1), number: text(40).min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), for_text: text(120).default('snow service'), lines, terms: text(120).default('Due on receipt'), pay_instructions: text(500).default('') }),
  z.object({ kind: z.literal('estimate'), company: text(200).min(1), customer: text(200).min(1), site: text(300).default(''), lines }),
  z.object({ kind: z.literal('log'), company: text(200).default(''), site: text(300).default(''), season: text(40).default(''), rows: z.number().int().min(5).max(40).default(25) }),
]);

const CTA = 'Do this automatically in Flake, free this season: flake.216labs.dev';

/**
 * The free templates (issue 237): an invoice, an estimate and a plow log sheet, as PDFs, with no account. The same
 * rate limit as the other public tools. Nothing is stored and nothing is emailed.
 */
export const POST = route(async (req) => {
  await rateLimit(`tool:${clientIp(req)}`, 20, 60000);
  const b = await parseJson(req, body);
  const pdf = await import('@flake/providers/pdf');
  let out: Buffer;
  let name: string;
  if (b.kind === 'log') {
    out = await pdf.renderLogSheetPdf({ company: b.company, site: b.site, season: b.season, rows: b.rows, footer: CTA });
    name = 'snow-plow-log-sheet.pdf';
  } else {
    const total = b.lines.reduce((a, l) => a + l.amount_cents, 0);
    out = await pdf.renderInvoicePdf({
      kind: b.kind, company: { name: b.company }, customer: { name: b.customer },
      number: b.kind === 'invoice' ? b.number : `E-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      issuedAt: b.kind === 'invoice' ? `${b.date}T12:00:00Z` : new Date().toISOString(), timezone: 'UTC',
      storm: b.kind === 'invoice' ? b.for_text : b.site || 'snow service',
      lines: b.lines, totalCents: total, terms: b.kind === 'invoice' ? b.terms : 'Estimate, not a bill',
      payInstructions: b.kind === 'invoice' ? b.pay_instructions || null : null, footer: CTA,
    });
    name = b.kind === 'invoice' ? 'snow-removal-invoice.pdf' : 'snow-removal-estimate.pdf';
  }
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"` } });
});
