'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';

/** Authenticated setup area — auth-gated. The chrome is provided by OnboardingShell (rendered by the page). */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <LearnerGuard>{children}</LearnerGuard>;
}
