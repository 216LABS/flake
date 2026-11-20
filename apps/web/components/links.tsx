import { buttonVariants, cn } from '@flake/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * One link style for the office (issue 201). Names in tables read as names, not a page of blue underlines; actions are
 * buttons; filters are tabs; "Back to" is a breadcrumb at the top. Only these helpers may underline a link all the time
 * (e2e/link-style.spec.ts checks for strays).
 */

/** A customer, lot, storm or invoice name in a table or list: ink, medium weight, underline on hover only. */
export const entityLink = 'font-medium text-ink underline-offset-2 hover:underline focus-visible:underline';

/** A link inside a sentence of help text, where an underline is how people spot it. */
export const proseLink = 'font-medium text-link underline underline-offset-2';

/** A link that does something: looks like a button. */
export function ButtonLink({ variant = 'outline', size, className, ...props }: ComponentProps<typeof Link> & { variant?: 'primary' | 'accent' | 'outline' | 'ghost'; size?: 'sm' | 'md' | 'lg' }) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** A plain download or external link styled as a button (for files and API routes, not pages). */
export function ButtonA({ variant = 'outline', size, className, ...props }: ComponentProps<'a'> & { variant?: 'primary' | 'accent' | 'outline' | 'ghost'; size?: 'sm' | 'md' | 'lg' }) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** "Back to ..." as a breadcrumb at the top of a page. */
export function Breadcrumb({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 print:hidden" data-print-hide>
      <Link href={href} className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-control px-1 text-sm font-medium text-muted hover:text-ink" data-testid={testId}>
        <ChevronLeft size={16} aria-hidden="true" />{children}
      </Link>
    </nav>
  );
}

/** Filters as tabs: Active / Archived, Recent / All. Each is a link, so the choice is in the address. */
export function FilterTabs({ label, items, className }: { label: string; items: { href: string; label: ReactNode; active: boolean; testId?: string }[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn('mb-4 flex flex-wrap gap-1 border-b border-line-faint', className)}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined} data-testid={i.testId}
          className={cn('-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold', i.active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
