import { runJobs } from '@/lib/handlers';
import { requireCron, route } from '@/lib/http';

export const maxDuration = 60;

export const GET = route(async (req) => {
  requireCron(req);
  return runJobs();
});
