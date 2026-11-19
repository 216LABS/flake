import { eq, serviceDb, tenant } from '@flake/db';
import { getBlob } from '@/lib/blob';
import { isUuid } from '@/lib/http';
import { logoType } from '@/lib/logo';

/**
 * A company's logo for its customer pages (issue 173). Public like the name beside it; only the logo file is served,
 * never anything else in the company's storage.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isUuid(tenantId)) return new Response('Not found', { status: 404 });
  const [t] = await serviceDb().select({ logo_path: tenant.logo_path }).from(tenant).where(eq(tenant.id, tenantId));
  const bytes = t?.logo_path?.startsWith(`${tenantId}/logo/`) ? await getBlob('contracts', t.logo_path).catch(() => null) : null;
  const kind = bytes ? logoType(bytes) : null;
  if (!bytes || !kind) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': kind === 'png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" },
  });
}
