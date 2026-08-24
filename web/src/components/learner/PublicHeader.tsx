'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/i18n-context';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

/** Public top bar for the landing + auth pages: Izlan brand (→ /), UI-language and theme controls, optional CTA. */
export function PublicHeader({ cta }: { cta?: React.ReactNode }) {
  const t = useT();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-text">
          {t('landing.brand')}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {cta}
        </div>
      </div>
    </header>
  );
}
