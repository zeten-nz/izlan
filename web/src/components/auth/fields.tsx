'use client';

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { FiEye, FiEyeOff, FiLoader } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';

/*
 * Design-faithful field/button set for the "01 — Auth" flow. These intentionally do NOT reuse the app's generic
 * primitives (h-10 inputs / h-10 buttons): the approved design specifies 48px inputs, 52px buttons, 10px radii and a
 * 3px brand-tint focus ring. Kept in one file to avoid atomic fragmentation.
 */

const INPUT_BASE =
  'h-12 w-full rounded-[10px] border border-border bg-surface px-4 text-[15px] text-text placeholder:text-muted transition-[border-color,box-shadow] focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary-tint disabled:opacity-60';

/** Section heading (title + optional subtitle) used at the top of every auth screen. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-text">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
    </div>
  );
}

/** Labeled field wrapper. `trailing` renders opposite the label (e.g. the "Forgot password?" link). */
export function AuthField({
  label,
  htmlFor,
  hint,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-text">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const AuthInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function AuthInput(
  { className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`${INPUT_BASE} ${className}`} {...rest} />;
});

/** Password field with an accessible show/hide toggle. Never trims or persists the value. */
export function AuthPasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <AuthInput
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('authui.hidePassword') : t('authui.showPassword')}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center text-muted transition-colors hover:text-text"
      >
        {show ? <FiEyeOff aria-hidden /> : <FiEye aria-hidden />}
      </button>
    </div>
  );
}

/** Primary full-width auth action button (52px, brand, hover → brand-600). */
export function AuthButton({
  children,
  loading,
  disabled,
  type = 'submit',
  onClick,
}: {
  children: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-bold text-primary-fg transition-[background-color,transform] hover:bg-primary-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {loading && <FiLoader className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Inline form error (brand danger + danger-tint). Announced to assistive tech. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[10px] bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
      {children}
    </p>
  );
}
