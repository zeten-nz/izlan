'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import uz, { type Messages } from './messages/uz';
import ru from './messages/ru';
import en from './messages/en';

export type Locale = 'uz' | 'ru' | 'en';
export const LOCALES: Locale[] = ['uz', 'ru', 'en'];
export const DEFAULT_LOCALE: Locale = 'uz';
const STORAGE_KEY = 'izl-locale'; // UI locale only — NOT authentication data (safe to persist)

const DICTS: Record<Locale, Messages> = { uz, ru, en };

// Flatten nested dictionaries to `ns.sub.key` → string once per module load.
function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}
const FLAT: Record<Locale, Record<string, string>> = {
  uz: flatten(uz as unknown as Record<string, unknown>),
  ru: flatten(ru as unknown as Record<string, unknown>),
  en: flatten(en as unknown as Record<string, unknown>),
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}
const I18nContext = createContext<I18nContextValue | null>(null);

function readStored(): Locale | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'uz' || s === 'ru' || s === 'en') return s;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = readStored();
    if (stored && stored !== locale) setLocaleState(stored);
    document.documentElement.lang = stored ?? DEFAULT_LOCALE;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
      document.cookie = `${STORAGE_KEY}=${l}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const t = useCallback<TFunc>(
    (key, vars) => {
      const table = FLAT[locale];
      const value = table[key] ?? FLAT[DEFAULT_LOCALE][key] ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Default-locale translator used when no I18nProvider is mounted (e.g. isolated component tests). */
export const defaultT: TFunc = (key, vars) => interpolate(FLAT[DEFAULT_LOCALE][key] ?? key, vars);

/** Convenience hook returning just the translate function. Degrades to the default-locale translator w/o a provider. */
export function useT(): TFunc {
  const ctx = useContext(I18nContext);
  return ctx ? ctx.t : defaultT;
}
