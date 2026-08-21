'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'izl-theme'; // theme preference only — NEVER any auth token

interface ThemeContextValue {
  pref: ThemePref;
  resolved: Resolved;
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPref(): Resolved {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(resolved: Resolved): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [resolved, setResolved] = useState<Resolved>('light');

  useEffect(() => {
    let stored: ThemePref = 'system';
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === 'light' || s === 'dark' || s === 'system') stored = s;
    } catch {
      /* storage unavailable → default system */
    }
    setPrefState(stored);
    const r = stored === 'system' ? systemPref() : stored;
    setResolved(r);
    apply(r);
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = systemPref();
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
    const r = p === 'system' ? systemPref() : p;
    setResolved(r);
    apply(r);
  }, []);

  const toggle = useCallback(() => {
    setPref(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPref]);

  const value = useMemo(() => ({ pref, resolved, setPref, toggle }), [pref, resolved, setPref, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
