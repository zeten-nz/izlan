'use client';

import { FiGlobe } from 'react-icons/fi';
import { LOCALES, useI18n, type Locale } from '@/lib/i18n/i18n-context';

/** Compact UI-language switcher (uz/ru/en). Persists locale (not auth) and never touches authored content. */
export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="relative inline-flex items-center">
      <FiGlobe aria-hidden className="pointer-events-none absolute left-2 text-muted" />
      <span className="sr-only">{t('locale.switch')}</span>
      <select
        aria-label={t('locale.switch')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-9 appearance-none rounded-lg border border-border bg-surface pl-7 pr-6 text-sm text-text transition-colors hover:bg-surface-2 focus:border-primary focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`locale.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
