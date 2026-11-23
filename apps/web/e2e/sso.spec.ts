import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Issue 242: Continue with Microsoft or Google, connecting them under Account, and a password for people with neither.
 * The local Supabase has no provider apps, so the provider's page is stood in for: the test checks what Flake sends to
 * Supabase (provider, PKCE challenge, return address) and plays the provider's answer back through /auth/callback.
 */
const once = (name: string) => test.skip(name !== 'iphone-13', 'once is enough');

async function newUser(page: Page, password = 'flake-demo-only') {
  const email = `sso-${randomUUID().slice(0, 8)}@flake.test`;
  const res = await page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, data: { email, password } });
  expect(res.ok()).toBe(true);
  return email;
}

test('sign in: Microsoft and Google buttons start PKCE sign-in and come back through the callback; a cancel says so', async ({ page }, info) => {
  once(info.project.name);
  const seen: URL[] = [];
  await page.route('**/auth/v1/authorize**', async (r) => {
    const u = new URL(r.request().url());
    seen.push(u);
    // The provider said no: Supabase sends the person back with the error.
    await r.fulfill({ status: 302, headers: { location: `${new URL(page.url()).origin}/auth/callback?error=access_denied&error_description=The+user+cancelled` } });
  });
  await page.goto('/login?next=/billing');
  await expect(page.getByTestId('sso-azure')).toContainText('Continue with Microsoft');
  await expect(page.getByTestId('sso-google')).toContainText('Continue with Google');
  // The email code is still there, and so is a password.
  await expect(page.getByTestId('send-link')).toBeVisible();
  await expect(page.getByTestId('use-password')).toBeVisible();
  const box = (await page.getByTestId('sso-google').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  await page.getByTestId('sso-google').click();
  await page.waitForURL(/\/login\?error=access_denied/);
  await expect(page.getByTestId('login-error')).toContainText('Sign-in was cancelled');
  // Back to the page that asked, after the next try.
  expect(page.url()).toContain('next=%2Fbilling');
  const g = seen[0]!;
  expect(g.searchParams.get('provider')).toBe('google');
  expect(g.searchParams.get('redirect_to')).toMatch(/\/auth\/callback$/);
  expect(g.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);
  expect(g.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
  expect(g.searchParams.get('prompt')).toBe('select_account');

  await page.getByTestId('sso-azure').click();
  await page.waitForURL(/\/login\?error=access_denied/);
  const m = seen[1]!;
  expect(m.searchParams.get('provider')).toBe('azure');
  expect(m.searchParams.get('scopes')).toContain('email');
  expect(m.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);
});

test('callback: a stale or foreign code goes back to sign in with words, not a blank dashboard bounce', async ({ page }, info) => {
  once(info.project.name);
  await page.goto('/auth/callback?code=not-a-real-code');
  await page.waitForURL(/\/login\?error=/);
  await expect(page.getByTestId('login-error')).toBeVisible();
  // A made-up error code shows the general words.
  await page.goto('/login?error=%3Cb%3Ehi');
  await expect(page.getByTestId('login-error')).toHaveText('That sign-in didn’t work. Try again, or sign in with your email.');
});

test('password: someone with no Microsoft or Google signs in with a password, and a wrong one says what to do', async ({ page }, info) => {
  once(info.project.name);
  const email = await newUser(page, 'plow-it-2026');
  await page.goto('/login');
  await page.getByTestId('use-password').click();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('wrong-password');
  await page.getByTestId('password-sign-in').click();
  await expect(page.getByTestId('login-error')).toContainText('don’t match');
  await page.getByTestId('password').fill('plow-it-2026');
  await page.getByTestId('password-sign-in').click();
  // A brand-new person sets up a company; the hint tells someone joining a company not to.
  await page.waitForURL('**/onboarding');
  await expect(page.getByTestId('join-hint')).toBeVisible();
  await expect(page.getByTestId('split-account')).toHaveCount(0);
});

test('Account: lists ways to sign in, connects Google through the callback, explains a taken account, and sets a password', async ({ page }, info) => {
  once(info.project.name);
  test.setTimeout(90_000);
  const email = await newUser(page);
  await page.request.post('/api/dev/login', { data: { email } });
  await page.goto('/onboarding');
  await page.getByTestId('company').fill(`SSO ${email.slice(4, 12)}`);
  await page.getByTestId('agree-terms').check();
  await page.getByTestId('create-company').click();
  await page.waitForURL('**/dashboard');

  // On a phone, Account is under More, which leaves the header room for the company name.
  await expect(page.getByTestId('account-link')).toBeHidden();
  await page.getByTestId('more-tab').click();
  await page.getByTestId('more-menu').getByRole('link', { name: 'Account' }).click();
  await page.waitForURL('**/account');
  await expect(page.getByTestId('account-email')).toHaveText(email);
  await expect(page.getByTestId('identity-email')).toBeVisible();
  await expect(page.getByTestId('connect-azure')).toContainText('Connect Microsoft');

  // Connecting asks Supabase for the provider's address; here the provider reports that account is someone else's.
  let asked: URL | null = null;
  await page.route('**/auth/v1/user/identities/authorize**', async (r) => {
    asked = new URL(r.request().url());
    await r.fulfill({ json: { url: `${new URL(page.url()).origin}/auth/callback?error=server_error&error_description=Identity+is+already+linked+to+another+user` } });
  });
  await page.getByTestId('connect-google').click();
  await page.waitForURL(/\/account\?error=link_taken/);
  await expect(page.getByTestId('account-error')).toContainText('already connected to a different Flake sign-in');
  expect(asked!.searchParams.get('provider')).toBe('google');
  expect(asked!.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);

  // Password: checked, then saved, then it signs in.
  await page.getByTestId('new-password').fill('short');
  await page.getByTestId('new-password-2').fill('short');
  await page.getByTestId('save-password').click();
  await expect(page.getByTestId('account-error')).toContainText('at least 8');
  await page.getByTestId('new-password').fill('salt-the-lot-9');
  await page.getByTestId('new-password-2').fill('salt-the-lot-8');
  await page.getByTestId('save-password').click();
  await expect(page.getByTestId('account-error')).toContainText('don’t match');
  await page.getByTestId('new-password-2').fill('salt-the-lot-9');
  await page.getByTestId('save-password').click();
  await expect(page.getByTestId('account-note')).toContainText('Password saved');

  await page.getByTestId('sign-out').click();
  await page.waitForURL('**/login');
  await page.getByTestId('use-password').click();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('salt-the-lot-9');
  await page.getByTestId('password-sign-in').click();
  await page.waitForURL('**/dashboard');
});
