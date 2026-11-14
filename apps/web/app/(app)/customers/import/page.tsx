import { PageHeader } from '@flake/ui';
import { redirect } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { ImportForm } from './import-form';

export const metadata = { title: 'Import customers' };

export default async function ImportCustomers() {
  const ctx = await requirePage();
  if (ctx.role === 'viewer') redirect('/customers');
  return (
    <>
      <PageHeader title="Import customers" subtitle="Bring your customer list over from a spreadsheet. Nothing is sent to anyone." />
      <ImportForm />
    </>
  );
}
