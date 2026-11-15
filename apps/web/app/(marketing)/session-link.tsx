'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * "Sign in" for visitors, "Open Flake" for someone already signed in (issue 152), who otherwise had no way back into
 * the app from the home page. The pages stay static: the session cookie is checked in the browser.
 */
export function SessionLink({ className, signedOut }: { className: string; signedOut: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(/(^|;\s*)sb-[^=]*-auth-token[^=]*=/.test(document.cookie)), []);
  return signedIn
    ? <Link href="/dashboard" className={className} data-testid="open-flake">Open Flake</Link>
    : <Link href="/login" className={className}>{signedOut}</Link>;
}
