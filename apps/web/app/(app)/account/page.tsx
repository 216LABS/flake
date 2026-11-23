import { PageHeader } from '@flake/ui';
import { requirePage } from '@/lib/auth';
import { enabledSso, ssoErrorText } from '@/lib/sso';
import { AccountPanel } from './account-panel';

export const metadata = { title: 'Account' };

/** Your own sign-in, for every role (issue 242): connect Microsoft or Google, or set a password. */
export default async function Account({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requirePage();
  const q = await searchParams;
  return (
    <>
      <PageHeader title="Account" subtitle="How you sign in to Flake. Your company and role don’t change." />
      <AccountPanel email={ctx.email} providers={await enabledSso()} initialError={ssoErrorText(q.error)} />
    </>
  );
}
