'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/i18n-context';
import { StepProgress, ThemeSwitcher } from '@/components/ui';
import { AuthLangPill } from '@/components/auth/AuthLangPill';

/** The two-square Izlan brand mark (shared visual identity with Auth). */
function BrandMark() {
  return (
    <span className="relative inline-block h-[26px] w-[26px]" aria-hidden>
      <span className="absolute left-0 top-0 h-[17px] w-[17px] rounded-[5px] bg-primary" />
      <span className="absolute bottom-0 right-0 h-[13px] w-[13px] rounded-full border-2 border-primary bg-surface" />
    </span>
  );
}

/**
 * Focused onboarding chrome: a restrained top bar (Izlan identity + step progress + theme + language) over a
 * centered single-column workflow — no learner sidebar. Theme-aware (Light/Dark/System) via the shared foundation.
 * `step` is the 0-based index into [Profil, Yo'nalish, Daraja]; Daraja is the future Placement stage (Phase 02B).
 */
export function OnboardingShell({ step, children }: { step: 0 | 1; children: React.ReactNode }) {
  const t = useT();
  const steps = [t('learner.onboarding.stepProfile'), t('learner.onboarding.stepIntent'), t('learner.onboarding.stepPlacement')];
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-border bg-surface px-6 sm:px-10">
        <div className="flex flex-1 items-center">
          <Link href="/" className="flex items-center gap-2.5" aria-label={t('landing.brand')}>
            <BrandMark />
            <span className="text-lg font-extrabold tracking-tight">{t('landing.brand')}</span>
          </Link>
        </div>
        <div className="hidden flex-1 justify-center sm:flex">
          <StepProgress steps={steps} current={step} />
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <ThemeSwitcher />
          <AuthLangPill />
        </div>
      </header>

      {/* Compact step progress on mobile, where it can't share the top bar. */}
      <div className="flex justify-center border-b border-border bg-surface px-6 py-2.5 sm:hidden">
        <StepProgress steps={steps} current={step} />
      </div>

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-10 sm:py-12">{children}</main>
    </div>
  );
}
