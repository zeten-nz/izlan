'use client';

import { LearnerGuard } from '@/components/learner/LearnerGuard';
import { LearnerChrome } from '@/components/learner/LearnerChrome';

/** Authenticated learner area — auth-gated (→ /login) and wrapped in the learner shell (not the staff CMS sidebar). */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnerGuard>
      <LearnerChrome>{children}</LearnerChrome>
    </LearnerGuard>
  );
}
