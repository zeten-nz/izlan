'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';

/** Focused V2 teaching session — auth-gated; the page provides its own FocusLearningShell chrome (no sidebar). */
export default function TeachingLayout({ children }: { children: React.ReactNode }) {
  return <LearnerGuard>{children}</LearnerGuard>;
}
