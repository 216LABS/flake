import type { MetadataRoute } from 'next';

/** Lets the office app be added to a home screen, which iOS requires before it allows notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Flake',
    short_name: 'Flake',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0f172a',
    icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
