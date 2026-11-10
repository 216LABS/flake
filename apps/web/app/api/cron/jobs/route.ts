import { after } from 'next/server';
import { runJobs } from '@/lib/handlers';
import { requireCron, route } from '@/lib/http';
import { log } from '@/lib/log';
import { getSetting, setSetting } from '@/lib/providers';

export const maxDuration = 60;

async function work() {
  const result = await runJobs();
  const earlier = (await getSetting<string[]>('worker.runs')) ?? [];
  await setSetting('worker.runs', [...earlier.slice(-11), new Date().toISOString()]);
  return result;
}

/**
 * Answers the scheduler at once and drains the queue after the response. Holding pg_net's request open for the whole
 * 50 second run is what broke some calls in transit ("Error in the HTTP2 framing layer"), and the scheduler never reads
 * the body anyway. The run is recorded when it finishes, which is what /api/health watches.
 */
export const GET = route(async (req) => {
  requireCron(req);
  try {
    after(async () => {
      try {
        await work();
      } catch (err) {
        log.error('scheduled job run failed', err, {});
      }
    });
    return { started: true };
  } catch {
    // Outside a request (a script or a test) there's no after(), so just run it.
    return work();
  }
});
