import { crewImport } from '@flake/contracts';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { importCrew } from '@/lib/import';

/** Up to 50 crew rows per request (issue 174). Nothing is sent to anyone. */
export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { rows } = await parseJson(req, crewImport);
  return { results: await importCrew(ctx, rows) };
});
