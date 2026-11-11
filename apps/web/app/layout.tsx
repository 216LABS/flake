import type { Metadata, Viewport } from 'next';
import { Barlow_Semi_Condensed, Public_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const barlow = Barlow_Semi_Condensed({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-barlow', display: 'swap' });
const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
  title: { default: 'Flake by 216LABS: plowed, proved and paid', template: '%s | Flake' },
  description: 'Weather alerts that tell you when to roll, a no-install driver check-in, automatic proof of service and one-click billing for small plow companies.',
  icons: { icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '32x32' }], apple: '/apple-touch-icon.png' },
  openGraph: { images: [{ url: '/brand/flake-social-card.png', width: 1200, height: 630, alt: 'Flake: plowed, proved and paid' }] },
};

/** viewport-fit=cover, so the phone shell can pad itself clear of the notch and home indicator. */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${publicSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
