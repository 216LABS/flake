'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** These pages sort out their own controls, because a viewer can still use some of them there. */
const handlesItsOwnControls = (path: string) => path.startsWith('/proof') || path.startsWith('/settings') || /^\/storms\/[^/]+$/.test(path);

/** For a viewer, every control on the page is disabled in one place. The server refuses these requests either way. */
export function ViewOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <fieldset disabled={!handlesItsOwnControls(path)} className="contents">{children}</fieldset>;
}
