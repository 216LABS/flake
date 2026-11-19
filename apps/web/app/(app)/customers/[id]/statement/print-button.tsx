'use client';

/** Print, or save as PDF from the print dialog. */
export function PrintButton() {
  return <button type="button" className="rounded border px-3 py-1 font-semibold" onClick={() => window.print()} data-testid="statement-print">Print or save as PDF</button>;
}
