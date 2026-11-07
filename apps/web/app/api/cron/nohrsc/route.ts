import { requireCron, route } from '@/lib/http';
import { enqueue } from '@/lib/jobs';

export const GET = route(async (req) => {
  requireCron(req);
  const bucket = Math.floor(Date.now() / (6 * 3600000));
  await enqueue('weather.nohrsc', { hours: 24 }, { dedupeKey: `nohrsc:24:${bucket}` });
  await enqueue('weather.nohrsc', { hours: 6 }, { dedupeKey: `nohrsc:6:${bucket}` });
  return { queued: 2 };
});
