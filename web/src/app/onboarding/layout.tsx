'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';
import { PublicHeader } from '@/components/learner/PublicHeader';

/** Authenticated setup area — auth-gated but not the full learner shell (the user is still onboarding). */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnerGuard>
      <div className="flex min-h-screen flex-col bg-bg">
        <PublicHeader />
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
      </div>
    </LearnerGuard>
  );
}
