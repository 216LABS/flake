import { LinkGone } from '@/components/link-gone';

export const metadata = { title: 'Link not working', robots: 'noindex' };

/** Where a short link from a text goes when its code isn't found: a page, not a line of plain text. */
export default function ShortLinkGone() {
  return <LinkGone who="customer" />;
}
