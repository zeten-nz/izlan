'use client';

import { useState } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { Input } from '@/components/ui';
import { useT } from '@/lib/i18n/i18n-context';

/** Password field with an accessible show/hide toggle. Never persists the value. */
export function PasswordInput({
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
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted transition-colors hover:text-text"
      >
        {show ? <FiEyeOff aria-hidden /> : <FiEye aria-hidden />}
      </button>
    </div>
  );
}
