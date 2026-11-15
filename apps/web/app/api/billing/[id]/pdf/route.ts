import { eq, invoice_draft } from '@flake/db';
import { asUser, requireApi } from '@/lib/auth';
import { HttpError, isUuid, route } from '@/lib/http';
import { invoicePdf } from '@/lib/invoice-pdf';

/** The printable invoice for a bill past review (issue 146), for anyone in the company, viewers too. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('viewer');
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(404, 'Invoice not found');
  // Read through RLS first, so only this company's bill is found.
  const [mine] = await asUser(ctx, (tx) => tx.select({ id: invoice_draft.id }).from(invoice_draft).where(eq(invoice_draft.id, id)));
  const out = mine ? await invoicePdf(ctx.tenantId, id) : null;
  if (!out) throw new HttpError(404, 'Invoice not found. Only approved bills have an invoice.');
  return new Response(new Uint8Array(out.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${out.filename}"`, 'Cache-Control': 'private, no-store' } });
});
