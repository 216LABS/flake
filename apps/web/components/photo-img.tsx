'use client';

import { useState, type ImgHTMLAttributes } from 'react';

/**
 * A visit photo that says so when the browser can't show it, instead of a broken-image icon. That's a HEIC photo from a
 * phone whose browser couldn't make a JPEG copy either (an Android set to "high efficiency"). The original is still
 * stored and still counts as proof.
 */
export function PhotoImg({ className, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span role="img" aria-label={`${alt}: saved, no preview`} className={`${className ?? ''} flex items-center justify-center bg-tint-2 p-2 text-center text-xs text-muted`} data-testid="photo-no-preview">
        Photo saved. No preview for this phone&apos;s format.
      </span>
    );
  }
  return <img {...rest} alt={alt} className={className} onError={() => setFailed(true)} />;
}
