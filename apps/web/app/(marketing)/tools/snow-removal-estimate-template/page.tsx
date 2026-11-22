import type { Metadata } from 'next';
import { EstimateTemplate } from '../template-tools';
import { ToolPage } from '../tool-page';

export const metadata: Metadata = {
  title: 'Free Snow Removal Estimate Template (PDF)',
  description: 'Price a lot from its size or address, then download a snow removal estimate PDF for your customer: per push, per storm or seasonal. No account needed.',
  alternates: { canonical: '/tools/snow-removal-estimate-template' },
  openGraph: { title: 'Free snow removal estimate template', description: 'A snow plowing estimate PDF priced from the lot size.' },
};

export default function Page() {
  return (
    <ToolPage
      title="Free snow removal estimate template"
      intro="Enter the lot's size, or its address and we'll measure it, get suggested prices, edit them, and download an estimate PDF for your customer. No account needed."
      name="Snow removal estimate template"
      steps={['Enter your company, the customer and the property', 'Enter the paved area, or let the address be measured', 'Edit the suggested prices', 'Download the estimate PDF or the spreadsheet']}
      faq={[
        ['How are the prices suggested?', 'From the paved area and typical per-square-foot rates with a minimum per push. They are starting points labeled as assumptions, not market data. Change them to your own prices.'],
        ['Should I quote per push or seasonal?', 'Per push pays for every plowing; seasonal is one price for the winter. Many contractors offer both and let the customer choose. A seasonal price can include a set number of pushes, with each one after that billed.'],
        ['What about salt?', 'Add it as its own line, per bag, ton or application. Salt prices can change mid-season, so say how you will bill it.'],
        ['Can I turn the estimate into a contract?', 'Use the free contract builder, or quote in Flake, where the customer signs on their phone and the price carries into every bill.'],
      ]}
      explainer={<>
        <h2 className="text-xl font-semibold text-ink">Price the lot, not a guess</h2>
        <p>A lot&apos;s paved area drives the time it takes to plow. Measuring it first keeps your per-push price consistent from customer to customer, and the estimate shows the customer what they are buying.</p>
      </>}
    >
      <EstimateTemplate />
    </ToolPage>
  );
}
