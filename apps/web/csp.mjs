/**
 * The origin browser errors are sent to, from the public Sentry DSN (issue 180). Only that one host is allowed, not
 * every Sentry host; with no DSN, nothing is added.
 * @param {string | undefined} dsn
 */
export function sentryOrigin(dsn) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return u.protocol === 'https:' && /(^|\.)sentry\.io$/.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The site's Content-Security-Policy.
 * 'unsafe-inline' for scripts is needed by Next's inline bootstrap without per-request nonces.
 * @param {{ prod: boolean; supabase: string; sentryDsn?: string }} o
 */
export function buildCsp({ prod, supabase, sentryDsn }) {
  const sentry = sentryOrigin(sentryDsn);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com" + (prod ? '' : " 'unsafe-eval'"),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${supabase}`,
    `connect-src 'self' ${supabase} https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com https://api.mapbox.com https://api.stripe.com${sentry ? ` ${sentry}` : ''}`,
    'frame-src https://js.stripe.com https://hooks.stripe.com',
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
