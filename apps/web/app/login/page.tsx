import { demoLoginEnabled, isProd } from '@/lib/env';
import { safeNext } from '@/lib/next-path';
import { enabledSso, ssoErrorText } from '@/lib/sso';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; invited?: string }> }) {
  const q = await searchParams;
  return <LoginForm demo={!isProd() && demoLoginEnabled()} next={safeNext(q.next)} providers={await enabledSso()} initialError={ssoErrorText(q.error)} invited={q.invited === '1'} />;
}
