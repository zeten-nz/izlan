'use client';

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { FiLoader } from 'react-icons/fi';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Canonical control scale (00 — Foundations): sm 36 · md 44 (default) · lg 48 (form) · xl 52 (prominent CTA). */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[transform,background-color,color,box-shadow] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-600',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px]',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
  xl: 'h-[52px] px-6 text-[15px]',
};

/**
 * Single style authority for button-shaped elements. Both `Button` (real button) and `ButtonLink` (navigating
 * anchor) compose from this, so links styled as buttons never duplicate class strings.
 */
export function buttonClassName(opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  const { variant = 'primary', size = 'md', className = '' } = opts;
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`.trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, leftIcon, disabled, className = '', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} disabled={disabled || loading} className={buttonClassName({ variant, size, className })} {...rest}>
      {loading ? <FiLoader className="animate-spin" aria-hidden /> : leftIcon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-control transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${BTN_VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

/*
 * Canonical form controls (00 — Foundations): 44px height, 10px radius, brand-tint focus ring, danger border when
 * `aria-invalid`, muted surface when read-only/disabled. Auth keeps its own 48/52px form wrappers for the frozen flow.
 */
const INPUT_BASE =
  'w-full rounded-control border border-border bg-surface text-text transition-[border-color,box-shadow] focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary-tint disabled:opacity-60 read-only:bg-surface-2 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-tint';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`h-11 px-3.5 text-sm placeholder:text-muted ${INPUT_BASE} ${className}`} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`min-h-[88px] px-3.5 py-2.5 text-sm placeholder:text-muted ${INPUT_BASE} ${className}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} className={`h-11 px-3.5 text-sm ${INPUT_BASE} ${className}`} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-card border border-border bg-surface ${className}`}>{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function Spinner({ label = 'Yuklanmoqda' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <FiLoader className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}
