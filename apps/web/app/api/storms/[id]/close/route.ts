import { stormClose } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { closeStorm } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  const { force } = await parseJson(req, stormClose);
  return closeStorm(ctx, (await params).id, force);
});
