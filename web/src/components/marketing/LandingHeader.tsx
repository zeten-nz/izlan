'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FiMenu, FiX } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { BrandMark, Button, ThemeSwitcher } from '@/components/ui';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';

/**
 * Landing-only top bar (Phase 06). Kept SEPARATE from the shared PublicHeader so the auth pages are unaffected.
 * Desktop shows same-page anchor nav + locale/theme + Kirish/Bepul boshlash; mobile collapses the nav into an
 * accessible disclosure (aria-expanded / aria-controls). Real routes only: Kirish → /login, Bepul boshlash → /register.
 */
const NAV = [
  { key: 'navHow', href: '#how-it-works' },
  { key: 'navFeatures', href: '#features' },
  { key: 'navLibrary', href: '#library' },
  { key: 'navCommunity', href: '#community' },
  { key: 'navPlans', href: '#plans' },
] as const;

export function LandingHeader() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={t('landing.brand')}>
          <BrandMark />
          <span className="text-lg font-extrabold tracking-tight">{t('landing.brand')}</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-6 lg:flex" aria-label={t('landing.menuLabel')}>
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className="text-sm font-semibold text-muted transition-colors hover:text-text">
              {t(`landing.${n.key}`)}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2.5 md:flex">
          <LocaleSwitcher />
          <ThemeSwitcher />
          <Link href="/login" className="rounded-lg px-2.5 py-1.5 text-sm font-bold text-text transition-colors hover:text-primary">
            {t('landing.signIn')}
          </Link>
          <Link href="/register">
            <Button size="sm">{t('landing.getStarted')}</Button>
          </Link>
        </div>

        {/* Mobile controls */}
        <div className="ml-auto flex items-center gap-2 md:hidden">
          <LocaleSwitcher />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
            aria-label={t('landing.menuLabel')}
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border text-text transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {open ? <FiX aria-hidden /> : <FiMenu aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <div id="landing-mobile-menu" className="border-t border-border bg-surface md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3" aria-label={t('landing.menuLabel')}>
            {NAV.map((n) => (
              <a
                key={n.key}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-surface-2"
              >
                {t(`landing.${n.key}`)}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-3 border-t border-border px-1 pt-3">
              <ThemeSwitcher />
              <Link href="/login" onClick={() => setOpen(false)} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-bold text-text">
                {t('landing.signIn')}
              </Link>
              <Link href="/register" onClick={() => setOpen(false)}>
                <Button size="sm">{t('landing.getStarted')}</Button>
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
