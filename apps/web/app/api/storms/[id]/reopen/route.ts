import { requireApi } from '@/lib/auth';
import { route } from '@/lib/http';
import { reopenStorm } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return reopenStorm(ctx, (await params).id);
});
