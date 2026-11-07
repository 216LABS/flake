import { stormNotify } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { notifyCustomers } from '@/lib/storms';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireApi('dispatcher');
  return notifyCustomers(ctx, (await params).id, await parseJson(req, stormNotify));
});
