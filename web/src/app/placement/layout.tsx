'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';

/** Placement is an authenticated learner flow; the chrome is provided per-state by the page (Onboarding/Focus shell). */
export default function PlacementLayout({ children }: { children: React.ReactNode }) {
  return <LearnerGuard>{children}</LearnerGuard>;
}
