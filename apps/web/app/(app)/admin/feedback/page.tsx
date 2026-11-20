import { Card, EmptyState, PageHeader } from '@flake/ui';
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/auth';
import { listFeedback } from '@/lib/feedback';
import { isPlatformAdmin } from '@/lib/salt-orders';

export const metadata = { title: 'Feedback' };
export const dynamic = 'force-dynamic';

/** 216LABS only: everything sent with the corner "Report a problem" button, newest first, even when the email copy didn't go out. */
export default async function FeedbackAdmin() {
  const ctx = await requirePage();
  if (!isPlatformAdmin(ctx.email)) notFound();
  const items = await listFeedback();
  return (
    <>
      <PageHeader title="Feedback" subtitle="From every company, newest first. Each one is also emailed to ADMIN_EMAILS with a reply-to of the sender." />
      {items.length ? (
        <ul className="max-w-3xl space-y-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card data-testid="feedback-item">
                <p className="whitespace-pre-wrap wrap-anywhere">{f.message}</p>
                <p className="mt-2 text-sm text-muted">{f.company}, {f.email ?? 'unknown'} ({f.role}), on {f.path}, {new Date(f.at).toLocaleString('en-US', { timeZone: ctx.tenant.timezone })}</p>
              </Card>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No feedback yet" />}
    </>
  );
}
