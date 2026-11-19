import { NextResponse } from 'next/server';
import { clientIp, rateLimit, route } from '@/lib/http';
import { invoicePdf } from '@/lib/invoice-pdf';
import { resolvePortal } from '@/lib/portal';

/** A customer's own invoice as a PDF, from their records page (issue 146). */
export const GET = route<{ params: Promise<{ token: string; id: string }> }>(async (req, { params }) => {
  const { token, id } = await params;
  await rateLimit(`portal-invoice:${clientIp(req)}`, 30, 60_000);
  const who = await resolvePortal(token);
  const out = who && (await invoicePdf(who.tenantId, id, who.customerId));
  if (!out) return new NextResponse('This invoice is unavailable.', { status: 404 });
  return new Response(new Uint8Array(out.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${out.filename}"`, 'Cache-Control': 'private, no-store' } });
});
