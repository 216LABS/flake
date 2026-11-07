import { demoLoginEnabled, isProd } from '@/lib/env';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default function Login() {
  return <LoginForm demo={!isProd() && demoLoginEnabled()} />;
}
