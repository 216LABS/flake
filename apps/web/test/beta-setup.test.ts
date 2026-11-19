import { afterAll, describe, expect, it } from 'vitest';
import { app_setting, closeDb, crew_member, eq, message_log, serviceDb, sms_consent, sql } from '@flake/db';
import { makeWorld } from './helpers';

afterAll(async () => {
  await serviceDb().delete(app_setting).where(eq(app_setting.key, 'dev.unconfigured'));
  await closeDb();
});

describe('issue 179: money with a minus', () => {
  it('puts the minus sign before the dollar sign', async () => {
    const { money } = await import('@/lib/client');
    expect(money(-3000)).toBe('-$30.00');
    expect(money(-21100)).toBe('-$211.00');
    expect(money(123456)).toBe('$1,234.56');
    expect(money(0)).toBe('$0.00');
  });
});

describe('issue 180: Sentry is allowed by the CSP', () => {
  it('adds only the DSN host to connect-src, and nothing without a DSN', async () => {
    const { buildCsp, sentryOrigin } = await import('../csp.mjs');
    const dsn = 'https://abc123@o456.ingest.us.sentry.io/789';
    expect(sentryOrigin(dsn)).toBe('https://o456.ingest.us.sentry.io');
    expect(sentryOrigin('https://key@evil.example.com/1')).toBeNull();
    expect(sentryOrigin('not a url')).toBeNull();
    const csp = buildCsp({ prod: true, supabase: 'https://x.supabase.co', sentryDsn: dsn });
    expect(csp).toMatch(/connect-src [^;]*https:\/\/o456\.ingest\.us\.sentry\.io/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(buildCsp({ prod: true, supabase: '' })).not.toContain('sentry');
  });
});

describe('issue 174: crew CSV import', () => {
  it('reads the usual column names, flags bad rows and repeats, and ignores other columns', async () => {
    const { crewFromCsv } = await import('@/lib/csv');
    const out = crewFromCsv('Driver Name;Cell;Type;Idioma;Truck\nDana Ruiz;216-555-0101;employee;es;T1\nPat Kim;12;;;\nNorth Shore;;1099;;\nSam Lee;;boss;;\nDana again;(216) 555-0101;;;\nAna;;;fr;');
    expect(out.missing).toEqual([]);
    expect(out.rows.map((r) => r.problem === null)).toEqual([true, false, true, false, false, false]);
    expect(out.rows[3]!.problem).toContain('employee or sub');
    expect(out.rows[4]!.problem).toBe('Same person as #1.');
    expect(out.rows[5]!.problem).toContain('English or Spanish');
    expect(crewFromCsv('phone\n2165550101').missing).toEqual(['name']);
  });

  it('adds good rows with kind and language, skips people already on the crew, sends nothing', async () => {
    const { importCrew } = await import('@/lib/import');
    const w = await makeWorld();
    const ctx = { userId: w.userId, tenantId: w.tenantId };
    const before = (await serviceDb().select().from(message_log).where(eq(message_log.tenant_id, w.tenantId))).length;
    const res = await importCrew(ctx, [
      { name: 'Dana Ruiz', phone: '216-555-0161', kind: 'employee', language: 'Spanish' },
      { name: 'North Shore Plowing', kind: 'sub' },
      { name: 'Someone', phone: '216-555-0191' }, // Crew One's mobile
      { name: 'crew two' }, // same name as Crew Two, no mobile
      { name: 'Bad Phone', phone: '12' },
    ]);
    expect(res.map((r) => r.ok)).toEqual([true, true, false, false, false]);
    const rows = await serviceDb().select().from(crew_member).where(eq(crew_member.tenant_id, w.tenantId));
    expect(rows.find((c) => c.name === 'Dana Ruiz')).toMatchObject({ kind: 'employee', language: 'es', phone_e164: '+12165550161', joined_at: null });
    expect(rows.find((c) => c.name === 'North Shore Plowing')).toMatchObject({ kind: 'sub', language: 'en', phone_e164: null });
    expect(rows).toHaveLength(4);
    // A second run of the same file adds no one.
    expect((await importCrew(ctx, [{ name: 'Dana Ruiz', phone: '2165550161' }, { name: 'North Shore Plowing' }])).every((r) => !r.ok)).toBe(true);
    expect(await serviceDb().select().from(sms_consent).where(eq(sms_consent.tenant_id, w.tenantId))).toEqual([]);
    expect((await serviceDb().select().from(message_log).where(eq(message_log.tenant_id, w.tenantId))).length).toBe(before);
    // Another company's crew is never touched.
    const other = await makeWorld();
    await importCrew({ userId: other.userId, tenantId: other.tenantId }, [{ name: 'Dana Ruiz', phone: '216-555-0161' }]);
    expect((await serviceDb().select().from(crew_member).where(eq(crew_member.tenant_id, w.tenantId))).length).toBe(4);
  });
});

describe('issue 175: no Stripe keys', () => {
  it('reports payments and texting as unavailable when keys are missing', async () => {
    const { available } = await import('@/lib/providers');
    await serviceDb().execute(sql`delete from app_setting where key = 'dev.unconfigured'`);
    expect(await available()).toEqual({ payments: true, sms: true });
    await serviceDb().insert(app_setting).values({ key: 'dev.unconfigured', value: { payments: true } });
    expect(await available()).toEqual({ payments: false, sms: true });
    const { createProviders } = await import('@flake/providers');
    const live = createProviders({ mode: 'live', appEnv: 'production', env: {}, baseUrl: 'https://example.com' });
    expect(live.payments.unconfigured).toBe(true);
    expect(live.sms.unconfigured).toBe(true);
  });
});
