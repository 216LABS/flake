'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** These pages sort out their own controls, because a viewer can still use some of them there. */
const handlesItsOwnControls = (path: string) => path.startsWith('/proof') || path.startsWith('/reports') || path === '/account' || path.startsWith('/settings') || /^\/storms\/[^/]+$/.test(path)
  // Billing's storm picker and filter, and the customer search, are for reading (issue 131).
  || path.startsWith('/billing') || path === '/customers';
// Account is the person's own sign-in, which a viewer manages like anyone (issue 242).

/** For a viewer, every control on the page is disabled, and its buttons hidden, in one place. The server refuses these requests either way. */
export function ViewOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  const all = !handlesItsOwnControls(path);
  // Write buttons are hidden, not just greyed out, so the page reads like a report (issue 131).
  return <fieldset disabled={all} className={all ? 'view-only contents' : 'contents'}>{children}</fieldset>;
}
