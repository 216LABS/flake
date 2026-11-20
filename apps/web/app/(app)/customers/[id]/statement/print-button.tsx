'use client';

import { Button } from '@flake/ui';

/** Print, or save as PDF from the print dialog. */
export function PrintButton() {
  return <Button variant="outline" size="lg" type="button" onClick={() => window.print()} data-testid="statement-print">Print or save as PDF</Button>;
}
