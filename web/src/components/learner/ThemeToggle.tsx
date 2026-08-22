'use client';

import { FiMoon, FiSun } from 'react-icons/fi';
import { useTheme } from '@/lib/theme/theme-context';
import { useT } from '@/lib/i18n/i18n-context';

/** Compact light/dark toggle (reduced-motion friendly). Reuses the shared theme authority. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const t = useT();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t('theme.toLight') : t('theme.toDark')}
      className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {dark ? <FiSun aria-hidden /> : <FiMoon aria-hidden />}
    </button>
  );
}
