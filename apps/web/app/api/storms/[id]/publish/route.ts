import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { publishStorm } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return publishStorm(ctx, (await params).id);
});
