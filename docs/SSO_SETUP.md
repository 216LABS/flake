# Sign in with Microsoft or Google: setup (issue 242)

Flake's login page shows **Continue with Microsoft** and **Continue with Google** only after the provider is turned on in
the Supabase project. Until then the page looks as it did before: email code and password. Nothing goes in Vercel or the
repo: the client IDs and secrets live in the Supabase dashboard only.

Supabase handles the protocol: OpenID Connect with Authorization Code and PKCE, state and nonce, and checks on the ID token
(issuer, audience, signature, expiry). Flake gets a normal Supabase session back at `/auth/callback` and never sees the
provider's tokens.

You need three values from Supabase first:

- **Callback URL:** `https://<project-ref>.supabase.co/auth/v1/callback`. It's shown on each provider's page in Supabase,
  under Authentication, Sign In / Providers.
- **Site URL:** the app's address, for example `https://app.example.com`.
- **Redirect URLs** (Authentication, URL Configuration): add `https://<app domain>/auth/callback`. Add the preview
  pattern too if previews should sign in, for example `https://*-<vercel-team>.vercel.app/auth/callback`.

## Microsoft (Entra ID)

1. Go to portal.azure.com, then **Microsoft Entra ID**, **App registrations**, **New registration**.
   - Name: `Flake`.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**. Plow
     companies use their own Microsoft 365 tenants, and some use Outlook.com.
   - Redirect URI: platform **Web**, value = the Supabase callback URL.
2. On the app's **Overview**, copy the **Application (client) ID**.
3. **Certificates & secrets**, **New client secret**. Copy the **Value** (not the Secret ID) right away. It expires in at
   most 24 months: put the date on the calendar. When it expires, Microsoft sign-in stops and people fall back to the
   email code.
4. **Token configuration**, **Add optional claim**, token type **ID**: tick `email` and `xms_edov`. Accept the prompt to
   add the Microsoft Graph email permission. `xms_edov` tells Supabase that the organization owns the email's domain.
   Without it, Supabase treats Microsoft emails as unverified and won't join them to an existing Flake account by email.
5. **API permissions**: Microsoft Graph delegated `openid`, `email`, `profile` (and the default `User.Read`). No admin
   consent is needed for these.
6. In Supabase: Authentication, Sign In / Providers, **Azure**. Turn it on and paste the client ID and the secret
   **Value**. For **Azure Tenant URL**, leave it empty (any organization and personal accounts), or set
   `https://login.microsoftonline.com/<tenant-id>` to allow only one organization.

## Google

1. Go to console.cloud.google.com and pick or create a project (for example `flake-auth`).
2. **Google Auth Platform** (formerly OAuth consent screen):
   - **Branding:** app name `Flake`, a support email, the app's home page, privacy policy (`/legal/privacy`) and terms
     (`/legal/terms`) links. Authorized domains: the app's domain and `supabase.co`.
   - **Audience:** External, then **Publish app**. Until it's published, only listed test users can sign in.
   - **Data access:** `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. These are not sensitive
     scopes, so Google doesn't need to review them. Adding a logo does need Google to verify the branding.
3. **Clients**, **Create client**, type **Web application**:
   - Authorized JavaScript origins: the Site URL.
   - Authorized redirect URIs: the Supabase callback URL.
   - Copy the client ID and client secret.
4. In Supabase: Authentication, Sign In / Providers, **Google**. Turn it on and paste both.

Google's account chooser says "to continue to `<project-ref>.supabase.co`" unless the Supabase project has a custom domain.
That's a paid Supabase add-on, so it's Flip's call.

## The other Supabase switches

- **Allow manual linking** (Authentication, Sign In / Providers, user signups section): **on**. Account, Connect Microsoft
  or Google, needs it. That's how someone whose work account email differs from the email the office added connects
  it.
- **Email provider**: keep it on. The email code and the optional password both use it. Set the **minimum password
  length** to 8, the same as the app asks for.
- **Automatic linking** is built into Supabase. A provider sign-in whose email is verified joins the existing Flake
  account with that email. Everyone an owner adds in Settings, Team is created with a confirmed email, so their first
  Microsoft or Google sign-in lands in their company.

## How accounts line up

| Situation | What happens |
| --- | --- |
| The office added `pat@plowco.com`; Pat clicks Continue with Microsoft or Google with that same address | Same Flake account, same company and role |
| The office added `pat@plowco.com`; Pat's Google account is `pat.plowco@gmail.com` | Pat signs in with the email code once, then Account, **Connect Google**. After that either one works. |
| Someone new to Flake uses Microsoft or Google | A new account, then company setup, like the email code |
| A provider sign-in makes a second, empty account for an email the office already added (an unverified Microsoft email) | Onboarding says so and offers to sign out and use the email code. It doesn't offer to create a company. |
| No Microsoft or Google account | The email code, or a password set under Account |

Supabase stores each provider identity (provider, its user id, email and name) in `auth.identities`. The Flake user id,
and with it the company and role, stays the same whichever way the person signs in.

## Checking it

1. Open the login page in a private window. Both buttons should show within 5 minutes of turning the providers on (the app
   caches the list for 5 minutes).
2. Sign in with each one using a test account, and check that a teammate the office added lands in their company.
3. Account: the connected provider is listed with its email. Disconnect works when there's another way to sign in.

Errors come back to the login page (or to Account when connecting) as plain words: cancelled, already connected to a
different sign-in, started in a different browser, or a general failure. The server logs only the short reason, never a
code or token.

## Local and test

The local Supabase has no provider apps, so `packages/db/supabase/config.toml` keeps them off. The e2e run sets
`SSO_PROVIDERS=azure,google` to draw the buttons, and stands in for the provider's page. That override works only on a
laptop or in the test run. To try a real provider locally, register a second app with redirect
`http://127.0.0.1:54321/auth/v1/callback` and uncomment the blocks in `config.toml`.

## Adding another provider later

Supabase supports many (Apple, GitHub, Slack, Okta through SAML on paid plans, and others). For an OAuth one:

1. Register the app with the provider and turn it on in Supabase, as above.
2. In `apps/web/lib/sso.ts`, add it to `SSO_PROVIDERS` and `SSO_NAME`. In `apps/web/components/sso-buttons.tsx`, add it to
   the `SsoProvider` type, `NAME` and `ProviderLogo` (the provider's own mark, per its brand guide).
3. Add it to the e2e check in `e2e/sso.spec.ts`.
