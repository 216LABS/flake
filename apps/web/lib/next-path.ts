/**
 * Where to go after signing in (issue 142): a path on this site only. "//evil.example" and "/\evil.example" would
 * leave the site, so anything that isn't a plain local path goes to the dashboard.
 */
export function safeNext(v: string | null | undefined): string {
  if (!v || v.length > 500 || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || [...v].some((ch) => ch.charCodeAt(0) < 32)) return '/dashboard';
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/auth/')) return '/dashboard';
  return v;
}

/** Kept in a cookie for the magic link, which comes back through /auth/callback without the login page's query. */
export const NEXT_COOKIE = 'flake_next';
