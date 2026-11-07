import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
  title: { default: 'Flake by 216LABS: snow plow operations software', template: '%s | Flake' },
  description: 'Weather-triggered storm dispatch, a no-install driver check-in, automatic proof of service and one-click billing for small plow companies.',
  icons: { icon: '/icons/icon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
