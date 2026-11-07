import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default function Login() {
  return <LoginForm demo={process.env.APP_ENV !== 'production'} />;
}
