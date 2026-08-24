'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/i18n-context';
import { AuthLangPill } from './AuthLangPill';
import { AuthThemeSwitcher } from './AuthThemeSwitcher';
import { AuthLearningRail, type RailVariant } from './AuthLearningRail';

/** The two-square Izlan brand mark from the design (17px brand square + 13px ringed dot). */
function BrandMark() {
  return (
    <span className="relative inline-block h-[26px] w-[26px]" aria-hidden>
      <span className="absolute left-0 top-0 h-[17px] w-[17px] rounded-[5px] bg-primary" />
      <span className="absolute bottom-0 right-0 h-[13px] w-[13px] rounded-full border-2 border-primary bg-surface" />
    </span>
  );
}

/**
 * Split-layout auth shell: top bar (brand + theme + language) over the theme-aware form area and the deep learning rail.
 * The form side follows the global Light/Dark/System tokens; the rail stays deep (--color-panel) in both themes.
 */
export function AuthShell({ rail, children }: { rail: RailVariant; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="auth-scope flex min-h-screen flex-col bg-surface text-text">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border px-6 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5" aria-label={t('authui.brand')}>
          <BrandMark />
          <span className="text-lg font-extrabold tracking-tight text-text">{t('authui.brand')}</span>
        </Link>
        <div className="flex items-center gap-2">
          <AuthThemeSwitcher />
          <AuthLangPill />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
        <AuthLearningRail variant={rail} />
      </div>
    </div>
  );
}
