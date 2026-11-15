import { demoLoginEnabled, isProd } from '@/lib/env';
import { safeNext } from '@/lib/next-path';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <LoginForm demo={!isProd() && demoLoginEnabled()} next={safeNext((await searchParams).next)} />;
}
