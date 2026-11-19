import { PageHeader } from '@flake/ui';
import { redirect } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { CrewImportForm } from './crew-import-form';

export const metadata = { title: 'Import crew' };

/** Issue 174: a crew list from a spreadsheet, the way customers already come in. */
export default async function ImportCrew() {
  const ctx = await requirePage();
  if (ctx.role === 'viewer') redirect('/settings?tab=crew');
  return (
    <>
      <PageHeader title="Import crew" subtitle="Bring your drivers and subs over from a spreadsheet. Nothing is sent to anyone." />
      <CrewImportForm />
    </>
  );
}
