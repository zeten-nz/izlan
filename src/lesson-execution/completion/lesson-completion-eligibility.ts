import { ActivityType } from '@prisma/client';
import { isObjectiveActivityType, isViewOnlyActivityType } from '../../content/activity/activity-registry';

/**
 * Pure lesson-completion eligibility (lesson-completion-v1, TD-110, §2/8). No DB/HTTP/AI.
 *
 * EVERY Activity in the pinned revision is REQUIRED (no optional policy, §2). "Performed" ≠ mastered:
 * - objective (MINI_QUESTION/PRACTICE/MASTERY_TEST) → performed iff a SUBMITTED ActivityAttempt exists (§6);
 * - view-only (TEXT/EXPLANATION/IMAGE/AUDIO/EXAMPLE) → performed iff recorded in completedActivities (§4/7);
 * - anything else (LISTENING/WRITING/SPEAKING/AI_INTERACTION/VIDEO/…) → UNSUPPORTED for v1 completion (§4).
 * Correctness never gates completion (§12). Type classification is owned by the canonical Activity registry
 * (TD-246) — this module no longer keeps its own objective/view-only literals.
 */
export interface EligibilityActivity {
  id: string;
  type: ActivityType;
}

export interface EligibilityResult {
  eligible: boolean;
  totalActivities: number;
  completedActivities: number;
  remainingActivityIds: string[];
  unsupportedActivityIds: string[]; // types v1 cannot authoritatively complete (§4/50)
}

export function computeEligibility(activities: EligibilityActivity[], completedSet: ReadonlySet<string>, submittedSet: ReadonlySet<string>): EligibilityResult {
  const remaining: string[] = [];
  const unsupported: string[] = [];
  let performed = 0;
  for (const a of activities) {
    if (isObjectiveActivityType(a.type)) {
      if (submittedSet.has(a.id)) performed += 1; // evidence authority (§6)
      else remaining.push(a.id);
    } else if (isViewOnlyActivityType(a.type)) {
      if (completedSet.has(a.id)) performed += 1; // view-only cache authority (§7)
      else remaining.push(a.id);
    } else {
      unsupported.push(a.id); // deferred / unclassified — cannot complete in v1 (§4)
    }
  }
  return {
    eligible: unsupported.length === 0 && remaining.length === 0 && activities.length > 0,
    totalActivities: activities.length,
    completedActivities: performed,
    remainingActivityIds: remaining,
    unsupportedActivityIds: unsupported,
  };
}
