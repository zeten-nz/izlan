'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';

/** Focused lesson execution — auth-gated; the page provides its own FocusLearningShell chrome (no learner sidebar). */
export default function LessonLayout({ children }: { children: React.ReactNode }) {
  return <LearnerGuard>{children}</LearnerGuard>;
}
