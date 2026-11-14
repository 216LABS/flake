import { customerImport } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { importCustomers } from '@/lib/import';

export const maxDuration = 60;

/** Up to 25 rows of a customer list per request; the page sends a long list in batches. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { rows } = await parseJson(req, customerImport);
  return { results: await importCustomers(ctx, rows) };
});
