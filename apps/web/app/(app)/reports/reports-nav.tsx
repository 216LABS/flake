import { FilterTabs } from '@/components/links';

/** Reports, Payroll and Profit per lot as tabs, not sentences (issue 199). Payroll and profit show pay, so not for viewers. */
export function ReportsNav({ here, canSeePay }: { here: 'overview' | 'payroll' | 'profit'; canSeePay: boolean }) {
  if (!canSeePay) return null;
  return (
    <FilterTabs label="Reports" items={[
      { href: '/reports', label: 'Overview', active: here === 'overview', testId: 'reports-tab-overview' },
      { href: '/reports/payroll', label: 'Payroll', active: here === 'payroll', testId: 'open-payroll' },
      { href: '/reports/profit', label: 'Profit per lot', active: here === 'profit', testId: 'open-profit' },
    ]} />
  );
}
