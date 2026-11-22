import type { Metadata } from 'next';
import { LogSheetTemplate } from '../template-tools';
import { ToolPage } from '../tool-page';

export const metadata: Metadata = {
  title: 'Free Snow Plow Log Sheet (Printable PDF and Spreadsheet)',
  description: 'A printable snow plow service log for each site: date, arrive and leave times, snow depth, service, salt, weather and driver initials. PDF or spreadsheet, no account.',
  alternates: { canonical: '/tools/snow-plow-log-sheet' },
  openGraph: { title: 'Free snow plow log sheet', description: 'A printable per-site snow service log.' },
};

export default function Page() {
  return (
    <ToolPage
      title="Free snow plow log sheet"
      intro="A printable service log for one site, one line per visit. Keep it in the truck, or download the spreadsheet version. No account needed."
      name="Snow plow log sheet"
      steps={['Add your company and the site, if you like', 'Choose how many rows', 'Download the printable PDF or the spreadsheet', 'Fill in one line every visit and keep it with the photos']}
      faq={[
        ['Why keep a snow plow log?', 'If someone slips and falls, the first question is when you were there and what you did. A log written at the time, with times, depth, salt and weather, is the record that answers it.'],
        ['What goes on each line?', 'The date, the time you arrived and left, the snow depth you measured, what you did (plow, salt, walks), how much salt, the weather, and the driver\'s initials.'],
        ['How long should I keep logs?', 'Claims can arrive months or years after a storm, so keep them for several years. Ask your insurer or attorney what they want for your state.'],
        ['Is a paper log enough?', 'Paper is better than nothing, but it\'s easy to fill in later from memory, and that weakens it. Flake records each visit on the driver\'s phone with the time, GPS and photos, free this season.'],
      ]}
      explainer={<>
        <h2 className="text-xl font-semibold text-ink">Write it down at the time</h2>
        <p>The log is built around the things a slip-and-fall claim asks about: when you arrived and left, how much snow there was, what you did about it, and the weather. Fill in the line before you leave the lot, not at the end of the night.</p>
      </>}
    >
      <LogSheetTemplate />
    </ToolPage>
  );
}
