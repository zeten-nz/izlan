'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';
import { LearnerShell } from '@/components/learner/LearnerShell';

/** Authenticated learner area — auth-gated (→ /login) and wrapped in the final Phase 03 learner shell. */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnerGuard>
      <LearnerShell>{children}</LearnerShell>
    </LearnerGuard>
  );
}
