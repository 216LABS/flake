import type { Metadata } from 'next';
import { InvoiceTemplate } from '../template-tools';
import { ToolPage } from '../tool-page';

export const metadata: Metadata = {
  title: 'Free Snow Removal Invoice Template (PDF and Spreadsheet)',
  description: 'Fill in a snow plowing invoice in your browser, per push, per inch or seasonal, and download a PDF or a spreadsheet. No account needed.',
  alternates: { canonical: '/tools/snow-removal-invoice-template' },
  openGraph: { title: 'Free snow removal invoice template', description: 'A snow plowing invoice as a PDF or spreadsheet, with no account.' },
};

export default function Page() {
  return (
    <ToolPage
      title="Free snow removal invoice template"
      intro="Fill in your company, your customer and the pushes, then download a PDF to send or a spreadsheet to keep. There's no account and nothing is saved."
      name="Snow removal invoice template"
      steps={['Enter your company and who you are billing', 'Pick per push, per inch or seasonal, and edit the lines', 'Add your terms and how to pay', 'Download the PDF or the spreadsheet']}
      faq={[
        ['What should a snow removal invoice show?', 'Each visit or storm with its date, what was done (plow, salt, walks), the quantity and price, the total, when it is due, and how to pay. For per-inch pricing, say how deep the snow was and how it was measured.'],
        ['Per push or per storm on the invoice?', 'Bill the way the contract prices it. Per push lists each plowing; per storm lists one charge per event; seasonal lists the installment due. Salt usually goes on its own line by the bag, ton or application.'],
        ['Can I add a salt surcharge?', 'Yes, as its own line, priced from the salt you used. Saying why in one sentence helps customers accept it.'],
        ['Is this an accounting system?', 'No. It makes one invoice at a time. Flake builds them from your drivers\' visits and sends them to QuickBooks, free this season.'],
      ]}
      explainer={<>
        <h2 className="text-xl font-semibold text-ink">Bills customers don&apos;t argue with</h2>
        <p>Most snow billing disputes are about whether a visit happened and how much snow fell. Put the date and time of each visit on the invoice, keep the photos, and say what measured the inches. A clear invoice gets paid faster than a single &quot;snow service&quot; line.</p>
      </>}
    >
      <InvoiceTemplate />
    </ToolPage>
  );
}
