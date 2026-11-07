import type { Metadata, Viewport } from 'next';
import { DriverApp } from './driver-app';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return { title: 'Flake route', robots: 'noindex', manifest: `/d/${token}/manifest.webmanifest`, referrer: 'no-referrer' };
}

export const viewport: Viewport = { themeColor: '#0b1016', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DriverApp token={token} />;
}
