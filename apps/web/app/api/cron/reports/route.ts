import { queueMissedReports } from '@/lib/handlers';
import { requireCron, route } from '@/lib/http';

export const GET = route(async (req) => {
  requireCron(req);
  return queueMissedReports();
});
