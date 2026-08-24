'use client';

import { useEffect, useRef, useState } from 'react';
import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useTheme, type ThemePref } from '@/lib/theme/theme-context';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Canonical theme switcher (00 — Foundations): a compact icon button opening a 3-row popover — System / Light / Dark.
 * Behavior authority for every header (Auth, and later Onboarding/Learner/Admin). It is UI over the app's real
 * ThemeProvider (`setPref`) — no second theme store, no auth-sensitive storage (pref persists in `izl-theme`).
 * Accessible: labelled trigger, `menuitemradio` selection, Escape closes and restores focus, outside-click closes.
 */
export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const { pref, resolved, setPref } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const options: Array<{ value: ThemePref; label: string; Icon: typeof FiSun }> = [
    { value: 'system', label: t('theme.system'), Icon: FiMonitor },
    { value: 'light', label: t('theme.light'), Icon: FiSun },
    { value: 'dark', label: t('theme.dark'), Icon: FiMoon },
  ];
  const TriggerIcon = pref === 'system' ? FiMonitor : resolved === 'dark' ? FiMoon : FiSun;

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={t('theme.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
      >
        <TriggerIcon aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('theme.label')}
          className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-control border border-border bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.18)]"
        >
          {options.map(({ value, label, Icon }) => {
            const active = pref === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setPref(value);
                  setOpen(false);
                  btnRef.current?.focus();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors ${
                  active ? 'bg-primary-tint font-semibold text-primary' : 'text-text hover:bg-surface-2'
                }`}
              >
                <Icon aria-hidden className={active ? 'text-primary' : 'text-muted'} />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
