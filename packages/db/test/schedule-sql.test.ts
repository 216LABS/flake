import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scheduleSql = readFileSync(new URL('../sql/schedule_jobs.sql', import.meta.url), 'utf8');
const vercelPath = new URL('../../../apps/web/vercel.json', import.meta.url);

describe('free-plan schedules', () => {
  it('does not ask Vercel Hobby for a sub-daily cron', () => {
    if (!existsSync(vercelPath)) return;
    const vercel = JSON.parse(readFileSync(vercelPath, 'utf8')) as { crons?: { schedule: string }[] };
    for (const cron of vercel.crons ?? []) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      // One clock time per day. A star or a step in the minute or hour runs more often than Hobby allows.
      expect(minute, cron.schedule).toMatch(/^\d+$/);
      expect(hour, cron.schedule).toMatch(/^\d+$/);
    }
  });

  it('schedules each route from Vault, and can be run again', () => {
    for (const [name, cadence, path] of [
      ['flake-jobs', '* * * * *', '/api/cron/jobs'],
      ['flake-late-check', '*/5 * * * *', '/api/cron/late-check'],
      ['flake-weather', '*/15 * * * *', '/api/cron/weather'],
      ['flake-reports', '*/15 * * * *', '/api/cron/reports'],
      ['flake-nohrsc', '0 */6 * * *', '/api/cron/nohrsc'],
    ]) {
      expect(scheduleSql).toContain(`'${name}'`);
      expect(scheduleSql).toContain(`'${cadence}'`);
      expect(scheduleSql).toContain(`'${path}'`);
    }
    expect(scheduleSql).toContain("'flake-prune-log'");
    expect(scheduleSql).toContain('cron.unschedule');
    expect(scheduleSql).toContain('net.http_get');
    expect(scheduleSql).toContain("name = 'app_base_url'");
    expect(scheduleSql).toContain("name = 'cron_secret'");
    expect(scheduleSql).toContain('vault.decrypted_secrets');
    expect(scheduleSql).toContain("'Authorization'");
    expect(scheduleSql).not.toMatch(/https?:\/\//);
    expect(scheduleSql).not.toMatch(/Bearer [A-Za-z0-9]/);
  });
});
