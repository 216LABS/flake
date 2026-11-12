import { and, crew_member, desc, eq, job, message_log, serviceDb, sql, tenant } from '@flake/db';
import { fmtLocal, todayIn } from '@flake/core/time';
import { inFreeSeason } from '@flake/core/fees';
import { DEFAULT_RATE_CARD, type RateCard } from '@flake/core/quote';
import { Badge, Card, PageHeader, Table, Td, Th } from '@flake/ui';
import Link from 'next/link';
import { asUser, requirePage } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { canTextFrom } from '@/lib/messaging';
import { isPlatformAdmin, saltOrderingReady } from '@/lib/salt-orders';
import { SAMPLE_MESSAGES } from '@/lib/sms-admin';
import { breakerOpen, breakerState } from '@/lib/weather';
import { getProviders, getSetting } from '@/lib/providers';
import { listTeam } from '@/lib/team';
import { PushPanel } from './push-panel';
import { canSeeUsage, cronCalls, deploymentUsage, plainJobError } from '@/lib/usage';
import { BusinessForm, CompanyForm, CrewPanel, PaymentsPanel, PlanPanel, RateCardForm, RetryJob, SmsSubmit, TeamPanel } from './panels';

export const metadata = { title: 'Settings' };

const TABS = [['company', 'Company'], ['rate', 'Rate card'], ['crew', 'Crew'], ['team', 'Team'], ['alerts', 'Alerts'], ['payments', 'Payments'], ['sms', 'Text messages'], ['plan', 'Plan'], ['data', 'Data export'], ['system', 'System']] as const;
const EXPORTS = ['customer', 'site', 'contract', 'crew_member', 'route', 'storm', 'storm_run', 'run_stop', 'visit', 'visit_photo', 'visit_correction', 'problem_report', 'invoice_draft', 'message_log', 'proof_packet'];

/** Everything in these saves through owner-only routes. */
const OWNER_TABS = ['company', 'rate', 'team', 'payments', 'sms', 'plan', 'data'];

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: asked } = await searchParams;
  const ctx = await requirePage();
  const owner = ctx.role === 'owner';
  const tab = asked ?? (owner ? 'company' : 'crew');
  const allowed = owner || !OWNER_TABS.includes(tab);
  const readOnly = ctx.role === 'viewer';
  const t = ctx.tenant;
  const tz = t.timezone;
  const today = todayIn(tz);
  return (
    <>
      <PageHeader title="Settings" subtitle={`Routes are edited on the Routes page. You are the ${ctx.role}.`} />
      {/* Wraps on a phone so every section shows, instead of some hiding past the edge (issue 82). */}
      <nav aria-label="Settings sections" data-testid="settings-tabs" className="mb-5 flex flex-wrap gap-1 whitespace-nowrap border-b border-slate-300 text-sm md:flex-nowrap md:overflow-x-auto md:overflow-y-hidden md:[scrollbar-width:thin]">
        {TABS.filter(([k]) => owner || !OWNER_TABS.includes(k)).map(([k, label]) => <Link key={k} href={`/settings?tab=${k}`} data-testid={`tab-${k}`} aria-current={tab === k ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === k ? 'border-beacon text-slate-950' : 'border-transparent text-slate-600 hover:text-slate-950'}`}>{label}</Link>)}
      </nav>
      {!allowed ? <Card className="max-w-2xl" data-testid="owner-only"><p className="text-sm">Only an owner can open this.</p></Card> : null}
      {allowed && tab === 'company' ? <CompanyForm tenant={JSON.parse(JSON.stringify(t))} /> : null}
      {allowed && tab === 'rate' ? <RateCardForm card={(Object.keys(t.rate_card as object).length ? t.rate_card : DEFAULT_RATE_CARD) as RateCard} /> : null}
      {tab === 'crew' ? <fieldset disabled={readOnly} className="contents"><CrewPanel canText={canTextFrom(ctx.tenant)} crew={JSON.parse(JSON.stringify(await asUser(ctx, (tx) => tx.select().from(crew_member).orderBy(crew_member.name))))} /></fieldset> : null}
      {tab === 'alerts' ? <PushPanel publicKey={(await getProviders()).push.publicKey} /> : null}
      {allowed && tab === 'team' ? <TeamPanel members={await listTeam(ctx.tenantId)} me={ctx.userId} /> : null}
      {allowed && tab === 'payments' ? <PaymentsPanel connected={Boolean(t.stripe_account_id)} enabled={await chargesEnabled(t)} /> : null}
      {allowed && tab === 'sms' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold">Your text number</h2>
            <p className="mt-1 text-sm">Status: <Badge tone={t.sms_status === 'approved' ? 'green' : t.sms_status === 'rejected' ? 'red' : t.sms_status === 'pending' ? 'amber' : 'gray'} data-testid="sms-status">{t.sms_status}</Badge></p>
            {t.sms_sender ? <p className="mt-1 text-sm">Number: {t.sms_sender}</p> : null}
            {t.sms_status_detail ? <p className="mt-1 text-sm text-red-700">Reason: {t.sms_status_detail}. Fix the details and resubmit.</p> : null}
            <p className="mt-2 text-sm text-slate-600">Texts go out from your own verified toll-free number, in your legal business name. Verification takes 3 to 5 business days. Until then crew links go by email, QR and copy-link, and customer notices go by email.</p>
            <p className="mt-2 text-sm">Your public opt-in page: <Link className="text-sky-800 underline" href={`/b/${t.slug}/sms`}>{baseUrl()}/b/{t.slug}/sms</Link></p>
            <SmsSubmit status={t.sms_status ?? 'none'} />
            <h3 className="mt-4 text-sm font-medium">Sample messages we submit</h3>
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{SAMPLE_MESSAGES(t.name).map((m) => <li key={m}>{m}</li>)}</ul>
          </Card>
          <BusinessForm tenant={JSON.parse(JSON.stringify(t))} />
        </div>
      ) : null}
      {allowed && tab === 'plan' ? <PlanPanel plan={t.plan} freeUntil={t.free_season_until} inSeason={inFreeSeason(t.free_season_until, today)} /> : null}
      {allowed && tab === 'data' ? (
        <Card className="max-w-2xl">
          <h2 className="font-semibold">Export your data</h2>
          <p className="mt-1 text-sm text-slate-600">One CSV per table. Records are kept 7 years by default because claims can arrive months or years later. Photos and PDFs stay available through their links.</p>
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{EXPORTS.map((n) => <li key={n}><a className="text-sky-800 underline" href={`/api/settings/export?table=${n}`}>{n}</a></li>)}</ul>
        </Card>
      ) : null}
      {tab === 'system' ? await SystemTab(ctx.tenantId, tz, ctx.email, owner) : null}
    </>
  );
}

/**
 * Coming back from Stripe onboarding, the webhook that says charges are on can lag or be missing. Ask Stripe directly
 * while it still says off, and save what it says, so the owner isn't left looking at a stale "not enabled".
 */
async function chargesEnabled(t: { id: string; stripe_account_id: string | null; stripe_charges_enabled: boolean | null }) {
  if (t.stripe_charges_enabled || !t.stripe_account_id) return Boolean(t.stripe_charges_enabled);
  const { payments } = await getProviders();
  const on = await payments.chargesEnabled?.(t.stripe_account_id).catch(() => false);
  if (on) await serviceDb().update(tenant).set({ stripe_charges_enabled: true }).where(eq(tenant.id, t.id));
  return Boolean(on);
}

/** Dead letters and weather poller health. The job table is server-only, so this filters by tenant explicitly. */
async function SystemTab(tenantId: string, tz: string, email: string | null, canRetry: boolean) {
  const db = serviceDb();
  const dead = await db.select().from(job).where(and(sql`${job.dead_at} is not null`, sql`${job.payload}->>'tenantId' = ${tenantId}`)).orderBy(desc(job.dead_at)).limit(50);
  const retrying = await db.select().from(job).where(and(sql`${job.done_at} is null`, sql`${job.dead_at} is null`, sql`${job.last_error} is not null`, sql`${job.payload}->>'tenantId' = ${tenantId}`)).orderBy(desc(job.id)).limit(50);
  const [{ queued } = { queued: 0 }] = await db.select({ queued: sql<number>`count(*)::int` }).from(job).where(and(sql`${job.done_at} is null`, sql`${job.dead_at} is null`, eq(sql`${job.payload}->>'tenantId'`, tenantId)));
  const breaker = await breakerState();
  const runs = (await getSetting<string[]>('worker.runs')) ?? [];
  const gaps = runs.slice(1).map((at, i) => Math.round((Date.parse(at) - Date.parse(runs[i]!)) / 1000));
  const usage = canSeeUsage(email) ? await deploymentUsage() : null;
  const calls = canSeeUsage(email) ? await cronCalls() : null;
  const messages = await db.select().from(message_log).where(eq(message_log.tenant_id, tenantId)).orderBy(desc(message_log.created_at)).limit(30);
  return (
    <div className="space-y-4">
      {usage ? (
        <Card className="max-w-2xl" data-testid="usage">
          <h2 className="font-semibold">Storage</h2>
          <p className="mt-1 text-sm">Photos and files: {usage.files_mb} of {usage.files_limit_mb} MB. Database: {usage.db_mb} of {usage.db_limit_mb} MB.</p>
          {usage.near_limit ? <p className="mt-1 text-sm font-medium text-red-700">Nearly full. When files run out, photos wait on drivers&apos; phones until there is room.</p> : null}
        </Card>
      ) : null}
      <Card className="max-w-2xl">
        <h2 className="font-semibold">Weather poller</h2>
        <p className="mt-1 text-sm" data-testid="breaker">{breakerOpen(breaker) ? `Paused until ${fmtLocal(breaker.open_until!, tz)} after repeated errors.` : `Running. Consecutive failures: ${breaker.failures}.`}</p>
        <p className="mt-1 text-sm">Jobs queued for your company: {queued}</p>
        <p className="mt-1 text-sm" data-testid="worker-runs">{runs.length ? `Background worker last ran ${fmtLocal(runs[runs.length - 1]!, tz)}.${gaps.length ? ` Seconds between recent runs: ${gaps.join(', ')}.` : ''}` : 'Background worker: no scheduled runs recorded yet.'}</p>
      </Card>
      {canSeeUsage(email) ? (
        <Card className="max-w-2xl" data-testid="cron-calls">
          <h2 className="font-semibold">Scheduled calls</h2>
          {calls ? (
            <>
              <p className="mt-1 text-sm">{calls.failed ? `${calls.failed} of ${calls.total}` : `None of ${calls.total}`} calls from the database scheduler failed in about the last 6 hours.{calls.total && calls.failed / calls.total > 0.2 ? ' That is high: check the app is up and the Vault app_base_url is right.' : ''}</p>
              {calls.last_error ? <p className="mt-1 text-xs text-slate-600">Last failure{calls.last_failed_at ? ` ${fmtLocal(calls.last_failed_at, tz)}` : ''}: {calls.last_error}</p> : null}
              <p className="mt-1 text-xs text-slate-600">Every scheduled task is safe to miss once: the next call picks up the work.</p>
            </>
          ) : <p className="mt-1 text-sm text-slate-600">Not available here: the scheduler&apos;s log can&apos;t be read from this deployment.</p>}
        </Card>
      ) : null}
      {isPlatformAdmin(email) && (await saltOrderingReady()) ? (
        <Card className="max-w-2xl">
          <h2 className="font-semibold">216LABS</h2>
          <p className="mt-1 text-sm"><Link className="text-sky-800 underline" href="/admin/salt" data-testid="admin-salt-link">Salt suppliers and referral fees</Link></p>
        </Card>
      ) : null}
      <h2 className="font-semibold">Recent messages</h2>
      <Table stack data-testid="messages-table">
        <thead><tr><Th>When</Th><Th>Channel</Th><Th>To</Th><Th>Template</Th><Th>Status</Th></tr></thead>
        <tbody>
          {messages.map((m) => <tr key={m.id} data-testid="message-row" data-status={m.status ?? ''}><Td className="font-medium">{fmtLocal(m.created_at!, tz)}</Td><Td label="Channel">{m.channel}</Td><Td label="To">{m.to_addr}</Td><Td label="Message">{m.template}</Td><Td label="Status">{m.status === 'not_sent' ? 'Not sent: email is off' : m.status === 'rejected' ? 'Rejected: address not valid' : m.status}</Td></tr>)}
          {!messages.length ? <tr><Td colSpan={5}>None yet.</Td></tr> : null}
        </tbody>
      </Table>
      {retrying.length ? (
        <>
          <h2 className="font-semibold">Retrying</h2>
          <Table stack data-testid="retrying-jobs">
            <thead><tr><Th>Kind</Th><Th>Attempts</Th><Th>Error</Th><Th>Next try</Th></tr></thead>
            <tbody>
              {retrying.map((j) => <tr key={j.id}><Td className="font-medium">{j.kind}</Td><Td label="Attempts">{j.attempts}</Td><Td label="Error">{plainJobError(j.last_error)}</Td><Td label="Next try">{fmtLocal(j.run_at!, tz)}</Td></tr>)}
            </tbody>
          </Table>
        </>
      ) : null}
      <h2 className="font-semibold">Failed jobs</h2>
      <Table stack data-testid="dead-jobs">
        <thead><tr><Th>Kind</Th><Th>Attempts</Th><Th>Error</Th><Th>When</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>
          {dead.map((j) => <tr key={j.id}><Td className="font-medium">{j.kind}</Td><Td label="Attempts">{j.attempts}</Td><Td label="Error">{plainJobError(j.last_error)}</Td><Td label="When">{fmtLocal(j.dead_at!, tz)}</Td><Td>{canRetry ? <RetryJob id={j.id} /> : null}</Td></tr>)}
          {!dead.length ? <tr><Td colSpan={5}>None.</Td></tr> : null}
        </tbody>
      </Table>
    </div>
  );
}
