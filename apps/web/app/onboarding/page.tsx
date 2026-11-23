import { redirect } from 'next/navigation';
import { eq, membership, serviceDb } from '@flake/db';
import { currentUser } from '@/lib/auth';
import { teamAccountForEmail } from '@/lib/sso';
import { OnboardingForm } from './onboarding-form';

export const metadata = { title: 'Set up your company' };

export default async function Onboarding() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const [m] = await serviceDb().select().from(membership).where(eq(membership.user_id, user.id));
  if (m) redirect('/dashboard');
  // A Microsoft sign-in that didn't join the account the office made for this email (issue 242).
  return <OnboardingForm email={user.email} split={await teamAccountForEmail(user.id, user.email)} />;
}
