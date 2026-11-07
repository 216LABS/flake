import { and, crew_member, desc, eq, storm, storm_run } from '@flake/db';
import { Card, PageHeader } from '@flake/ui';
import { requirePage, asUser } from '@/lib/auth';
import { runLink } from '@/lib/storms';

export default async function DevHome() {
  const ctx = await requirePage();
  const runs = await asUser(ctx, (tx) => tx.select({ run: storm_run, storm, crew: crew_member }).from(storm_run).innerJoin(storm, eq(storm.id, storm_run.storm_id)).leftJoin(crew_member, eq(crew_member.id, storm_run.crew_id)).where(and(eq(storm.status, 'active'))).orderBy(desc(storm_run.created_at)).limit(20));
  return (
    <>
      <PageHeader title="Dev tools" subtitle="Local only. These routes return 404 in production." />
      <Card>
        <h2 className="font-semibold">Open as a driver</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {runs.map(({ run, storm: s, crew }) => {
            const link = runLink(run);
            return <li key={run.id}>{s.name}, {crew?.name ?? 'no driver'}: {link ? <a className="text-sky-800 underline" data-testid="impersonate" href={link}>open route</a> : 'no link'}</li>;
          })}
          {!runs.length ? <li>No active storm. Start one first.</li> : null}
        </ul>
      </Card>
    </>
  );
}
