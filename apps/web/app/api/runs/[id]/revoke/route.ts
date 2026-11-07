import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { revokeRunLink, runLink } from '@/lib/storms';

/** Rotates the token. The old link dies at once, and the new one can be sent or shown as a QR. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const run = await revokeRunLink(ctx, (await params).id);
  return { link: runLink(run) };
});
