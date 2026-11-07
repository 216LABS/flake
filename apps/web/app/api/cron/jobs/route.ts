import { runJobs } from '@/lib/handlers';
import { requireCron, route } from '@/lib/http';
import { getSetting, setSetting } from '@/lib/providers';

export const maxDuration = 60;

export const GET = route(async (req) => {
  requireCron(req);
  const result = await runJobs();
  const earlier = (await getSetting<string[]>('worker.runs')) ?? [];
  await setSetting('worker.runs', [...earlier.slice(-11), new Date().toISOString()]);
  return result;
});
