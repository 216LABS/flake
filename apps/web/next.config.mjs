const prod = (process.env.APP_ENV ?? (process.env.VERCEL_ENV === 'production' ? 'production' : 'local')) === 'production';
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// 'unsafe-inline' for scripts is needed by Next's inline bootstrap without per-request nonces.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com" + (prod ? '' : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${supabase}`,
  `connect-src 'self' ${supabase} https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com https://api.mapbox.com https://api.stripe.com`,
  'frame-src https://js.stripe.com https://hooks.stripe.com',
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@flake/core', '@flake/contracts', '@flake/db', '@flake/providers', '@flake/ui'],
  serverExternalPackages: ['@react-pdf/renderer', 'sharp', 'postgres', 'geotiff', 'exifr', 'web-push'],
  poweredByHeader: false,
  // Paths people type or guess, sent to the page they mean (issue 39 follow-up). Not permanent, so they can change.
  async redirects() {
    return [
      { source: '/terms', destination: '/legal/terms', permanent: false },
      { source: '/privacy', destination: '/legal/privacy', permanent: false },
      { source: '/sites', destination: '/customers', permanent: false },
      { source: '/alerts', destination: '/dashboard', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
        ],
      },
      // Signed tokens live in these URLs; never leak them in a Referer header.
      ...['/d/:path*', '/q/:path*', '/join/:path*', '/s/:path*', '/c/:path*', '/supplier/:path*'].map((source) => ({
        source,
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex' }],
      })),
      { source: '/sw.js', headers: [{ key: 'Service-Worker-Allowed', value: '/d/' }, { key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/push-sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default nextConfig;
