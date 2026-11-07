import { requireCron, route } from '@/lib/http';
import { scheduleWeather } from '@/lib/weather';

export const GET = route(async (req) => {
  requireCron(req);
  return scheduleWeather();
});
