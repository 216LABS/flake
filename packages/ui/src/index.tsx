import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-800',
        accent: 'bg-beacon text-slate-950 hover:bg-beacon-dark',
        outline: 'border border-slate-300 bg-white text-slate-900 hover:border-slate-500',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        danger: 'bg-red-700 text-white hover:bg-red-800',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-slate-200 bg-white p-4', className)} {...props} />;
}

const field = 'block w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-600';
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
  return <label className={cn('mb-1 block text-sm font-semibold text-slate-900', className)} {...props} />;
}

const tones = {
  gray: 'bg-slate-200 text-slate-900',
  blue: 'bg-sky-100 text-sky-900',
  green: 'bg-emerald-100 text-emerald-900',
  amber: 'bg-amber-200 text-amber-950',
  red: 'bg-red-100 text-red-900',
} as const;
export function Badge({ tone = 'gray', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn('font-display inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide', tones[tone], className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold text-slate-900">{title}</p>
      {body ? <p className="mt-1 text-sm text-slate-600">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className={cn('w-full text-left text-sm', className)} {...props} />
    </div>
  );
}
export const Th = (props: HTMLAttributes<HTMLTableCellElement>) => <th className="font-display border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600" {...props} />;
export const Td = (props: HTMLAttributes<HTMLTableCellElement> & { colSpan?: number }) => <td className="border-b border-slate-100 px-3 py-2.5 align-top" {...props} />;

/** The mark: an F whose arms are cut at the angle of plow striping. */
export function Wordmark({ className, inverse = true }: { className?: string; inverse?: boolean }) {
  return (
    <span className={cn('font-display inline-flex items-center gap-2 text-2xl font-bold tracking-tight', inverse ? 'text-white' : 'text-slate-950', className)}>
      <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><path d="M13 10h11v44H13z" fill="currentColor" /><path d="M24 10h30l-7 12H24zM24 28h20l-7 12H24z" fill="#f6b40e" /></svg>
      Flake
    </span>
  );
}

/** A small section title. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <h2 className={cn('font-display text-sm font-semibold uppercase tracking-wider text-slate-600', className)} {...props} />;
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
