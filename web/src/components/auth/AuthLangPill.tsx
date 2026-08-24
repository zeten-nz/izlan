'use client';

import { FiChevronDown } from 'react-icons/fi';
import { LOCALES, useI18n, type Locale } from '@/lib/i18n/i18n-context';

/** Compact language pill for the auth top bar (UZ/RU/EN). Native <select> styled as the design's rounded pill. */
export function AuthLangPill() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="relative inline-flex items-center">
      <span className="sr-only">{t('locale.switch')}</span>
      <select
        aria-label={t('locale.switch')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-8 cursor-pointer appearance-none rounded-full border border-border bg-surface pl-3 pr-8 text-xs font-semibold uppercase tracking-wide text-text transition-colors hover:bg-surface-2 focus:border-primary focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="normal-case">
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <FiChevronDown aria-hidden size={12} className="pointer-events-none absolute right-2.5 text-muted" />
    </div>
  );
}
