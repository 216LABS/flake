'use client';

import { useEffect, useState } from 'react';
import { Button, cn } from '@flake/ui';
import { ButtonA } from '@/components/links';
import { smsHref, type Share } from '@/lib/share';

/** "Text it from my phone": opens the office phone's Messages with the customer's number and the link (D16). */
export function TextIt({ share, testId = 'text-it', label = 'Text it from my phone', className }: { share: Share; testId?: string; label?: string; className?: string }) {
  // The href depends on the phone's maker, which only the browser knows; the first render uses the Android form.
  const [href, setHref] = useState(() => smsHref(share.phone, share.text, ''));
  useEffect(() => setHref(smsHref(share.phone, share.text)), [share.phone, share.text]);
  return <ButtonA size="sm" href={href} className={className} data-testid={testId} title={share.phone ? `Opens your messages to ${share.phone}` : 'Opens your messages; pick who to send it to'}>{label}</ButtonA>;
}

/** Copies a link, and says so; if the browser refuses, says to select the link instead. */
export function CopyLink({ url, testId = 'copy-link', className }: { url: string; testId?: string; className?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <Button size="sm" variant="outline" data-testid={testId} onClick={() => navigator.clipboard.writeText(url).then(() => setSaid('Copied'), () => setSaid('Select the link above to copy it.'))}>Copy link</Button>
      {said ? <span role="status" className="text-xs text-muted">{said}</span> : null}
    </span>
  );
}
