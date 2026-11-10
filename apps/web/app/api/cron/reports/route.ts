import { queueMissedReports } from '@/lib/handlers';
import { requireCron, route } from '@/lib/http';
import { checkTollFreeStatuses } from '@/lib/sms-admin';

export const GET = route(async (req) => {
  requireCron(req);
  const reports = await queueMissedReports();
  return { ...reports, tollfree: await checkTollFreeStatuses() };
});
