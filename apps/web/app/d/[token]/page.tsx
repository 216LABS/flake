import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { linkEverIssued } from '@/lib/driver';
import { DriverApp } from './driver-app';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return { title: 'Flake route', robots: 'noindex', manifest: `/d/${token}/manifest.webmanifest`, referrer: 'no-referrer' };
}

export const viewport: Viewport = { themeColor: '#0b1016', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A link that was never made gets the 404 every other bad public link gets. One that was made and later turned off
  // still loads the app: the phone may hold finished work to send, and the app says the link is no longer active.
  if (!(await linkEverIssued(token))) notFound();
  return <DriverApp token={token} />;
}
