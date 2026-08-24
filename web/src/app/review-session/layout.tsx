'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';

/** Focused review session — auth-gated; the page provides its own FocusLearningShell chrome (no learner sidebar). */
export default function ReviewSessionLayout({ children }: { children: React.ReactNode }) {
  return <LearnerGuard>{children}</LearnerGuard>;
}
