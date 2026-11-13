import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-800',
        accent: 'bg-beacon text-slate-950 hover:bg-beacon-dark',
        outline: 'border border-line bg-surface text-ink hover:border-line-strong',
        ghost: 'text-muted hover:bg-tint-2 hover:text-ink',
        danger: 'bg-red-700 text-white hover:bg-red-800',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { ref?: Ref<HTMLButtonElement> };
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-line-faint bg-surface p-4', className)} {...props} />;
}

const field = 'block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink disabled:bg-tint-2 disabled:text-muted';
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, className)} {...props} />;
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, className)} {...props} />;
}
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-sm font-semibold text-ink', className)} {...props} />;
}

const tones = {
  gray: 'bg-tint-3 text-ink',
  blue: 'bg-info-tint text-link',
  green: 'bg-ok-tint text-ok-ink',
  amber: 'bg-warn-strong text-warn-ink',
  red: 'bg-danger-tint text-danger-ink',
} as const;
export function Badge({ tone = 'gray', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn('font-display inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide', tones[tone], className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink md:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** `stack` makes each row a card on a phone; label its cells with Td's `label` (issue 47). */
export function Table({ className, stack = false, ...props }: HTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  return (
    <div tabIndex={0} className={cn('relative overflow-x-auto rounded-md border border-line-faint bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink', stack && 'table-stack')}>
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}
/** A class passed in adds to the cell's own look instead of replacing it. */
export const Th = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => <th className={cn('font-display border-b border-line-faint bg-tint-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted', className)} {...props} />;
export const Td = ({ className, label, ...props }: HTMLAttributes<HTMLTableCellElement> & { colSpan?: number; label?: string }) => <td className={cn('border-b border-line-faint px-3 py-2.5 align-top', className)} data-label={label} {...props} />;

/** The mark: a snowflake, with six arms and an amber V near each tip. */
export function Wordmark({ className, inverse = true }: { className?: string; inverse?: boolean }) {
  return (
    <span className={cn('font-display inline-flex items-center gap-2 text-2xl font-bold tracking-tight', inverse ? 'text-white' : 'text-ink', className)}>
      <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">{[0, 60, 120, 180, 240, 300].map((d) => <g key={d} transform={`rotate(${d} 32 32)`}><path d="M29.2 3h5.6v29h-5.6z" fill="currentColor" /><path d="M24.6 7.5L32 16l7.4-8.5" fill="none" stroke="#f6b40e" strokeWidth="4.6" /></g>)}</svg>
      Flake
    </span>
  );
}

/** A small section title. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <h2 className={cn('font-display text-sm font-semibold uppercase tracking-wider text-muted', className)} {...props} />;
}

/** A number you read from across a room. */
export function Stat({ label, value, note, className }: { label: string; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="font-display text-xs font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-display tabular mt-0.5 text-3xl font-semibold leading-tight md:text-4xl">{value}</div>
      {note ? <div className="mt-0.5 text-xs opacity-70">{note}</div> : null}
    </div>
  );
}

/** How much is finished. Turns green when all of it is. */
export function Progress({ value, max, className, label }: { value: number; max: number; className?: string; label?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label ?? 'Progress'} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={cn('h-2 overflow-hidden rounded-sm bg-slate-300/50', className)}>
      <div className={cn('h-full transition-all', percent === 100 ? 'bg-emerald-500' : 'bg-beacon')} style={{ width: `${percent}%` }} />
    </div>
  );
}

/* Driver kit: glove-first. Everything here is at least 60 px, with no hover-only behavior. */
const big = cva('font-display flex select-none items-center justify-center rounded-lg text-center font-bold tracking-wide active:brightness-125 disabled:opacity-40', {
  variants: {
    tone: {
      go: 'bg-beacon text-black',
      done: 'bg-emerald-400 text-black',
      plain: 'bg-slate-700 text-white',
      warn: 'border-2 border-orange-400 bg-transparent text-orange-300',
      on: 'bg-sky-300 text-black',
    },
    height: { tall: 'min-h-[72px] text-3xl', normal: 'min-h-[64px] text-xl' },
  },
  defaultVariants: { tone: 'plain', height: 'normal' },
});
export function BigButton({ tone, height, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof big>) {
  return <button type="button" className={cn(big({ tone, height }), 'min-w-[64px] px-4', className)} {...props} />;
}
export const bigButtonClass = (tone: 'go' | 'done' | 'plain' | 'warn' | 'on', height: 'tall' | 'normal' = 'normal') => cn(big({ tone, height }), 'min-w-[64px] px-4');
