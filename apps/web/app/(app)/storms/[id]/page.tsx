import { PageHeader, buttonVariants } from '@flake/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { HttpError, isUuid } from '@/lib/http';
import { getProviders } from '@/lib/providers';
import { stormLive } from '@/lib/storms';
import { StormBoard } from './storm-board';

export const metadata = { title: 'Storm' };

export default async function StormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePage();
  const live = await stormLive({ userId: ctx.userId, tenantId: ctx.tenantId, timezone: ctx.tenant.timezone }, id).catch((e) => {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  });
  if (!live) notFound();
  const { tiles } = await getProviders();
  return (
    <>
      <PageHeader title={live.storm.name} actions={<>
        <Link className={buttonVariants({ variant: 'outline' })} href={`/billing?storm=${id}`}>Billing</Link>
        <Link className={buttonVariants({ variant: 'outline' })} href={`/storms/${id}/pay`}>Sub pay</Link>
      </>} />
      <StormBoard stormId={id} initial={JSON.parse(JSON.stringify(live))} layers={tiles.layers()} />
    </>
  );
}
