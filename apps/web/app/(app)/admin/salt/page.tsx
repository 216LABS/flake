import { EmptyState, PageHeader } from '@flake/ui';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { adminOverview, isPlatformAdmin, saltOrderingReady } from '@/lib/salt-orders';
import { SaltAdmin } from './salt-admin';

export const metadata = { title: 'Salt suppliers' };
export const dynamic = 'force-dynamic';

/** 216LABS only: partner salt suppliers, the referral fees they owe, and where contractors want salt with no supplier yet. */
export default async function SaltAdminPage() {
  const ctx = await requirePage();
  if (!isPlatformAdmin(ctx.email)) notFound();
  if (!(await saltOrderingReady())) {
    return (
      <>
        <PageHeader title="Salt suppliers" />
        <EmptyState title="Salt ordering isn't set up on this database" body="Run supabase db push to add its tables, then reload." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Salt suppliers" subtitle="Partner distributors deliver and bill contractors directly. Flake pools small orders into truckloads and earns a referral fee per ton." />
      <SaltAdmin initial={JSON.parse(JSON.stringify(await adminOverview()))} />
    </>
  );
}
