'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Reusable 6-digit one-time-code input. One box per digit with full keyboard support:
 * typing advances, Backspace clears/retreats, arrows move, and pasting a full code fills every box.
 * The value is the concatenated string (may be < length while incomplete). Reused by registration + recovery.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const t = useT();
  const groupLabel = label ?? t('authui.otp.inputLabel');
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function focusBox(i: number) {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  }

  function commit(next: string[]) {
    onChange(next.join('').slice(0, length));
  }

  function fillFrom(start: number, raw: string) {
    const only = raw.replace(/\D/g, '');
    if (!only) return start;
    const next = digits.slice();
    let j = start;
    for (const ch of only) {
      if (j >= length) break;
      next[j] = ch;
      j += 1;
    }
    commit(next);
    return Math.min(j, length - 1);
  }

  function handleChange(i: number, raw: string) {
    const only = raw.replace(/\D/g, '');
    if (!only) {
      const next = digits.slice();
      next[i] = '';
      commit(next);
      return;
    }
    if (only.length === 1) {
      const next = digits.slice();
      next[i] = only;
      commit(next);
      if (i < length - 1) focusBox(i + 1);
      return;
    }
    // Multi-char (autofill / fast paste into a single box) → distribute across boxes.
    focusBox(fillFrom(i, only));
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = digits.slice();
        next[i] = '';
        commit(next);
      } else if (i > 0) {
        e.preventDefault();
        const next = digits.slice();
        next[i - 1] = '';
        commit(next);
        focusBox(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusBox(i + 1);
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.replace(/\D/g, '')) return;
    e.preventDefault();
    focusBox(fillFrom(i, text));
  }

  return (
    <div role="group" aria-label={groupLabel} className="flex gap-2.5">
      {digits.map((d, i) => (
        <input
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete="one-time-code"
          type="text"
          maxLength={1}
          aria-label={t('authui.otp.digitLabel', { n: i + 1 })}
          className="h-14 w-12 rounded-[10px] border border-border bg-surface text-center text-xl font-bold text-text transition-[border-color,box-shadow] focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary-tint disabled:opacity-60"
        />
      ))}
    </div>
  );
}
