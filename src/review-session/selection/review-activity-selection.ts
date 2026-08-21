/** review-session-v1 selection contract identifier (TD-126). Objective-only, ActivitySkill→LessonSkill fallback. */
export const REVIEW_SESSION_VERSION = 'review-session-v1';
export const REVIEW_SESSION_EVIDENCE_SCHEMA = 'review-session/v1';

/** One supported-objective Activity in the pinned encountered revision, with target-Skill attribution flags. */
export interface SelectionActivity {
  activityId: string;
  position: number; // Activity.position within the revision
  hasAnyActivitySkill: boolean; // whether the Activity has ANY ActivitySkill mapping
  attributedToTarget: boolean; // ActivitySkill(activity, targetSkill) exists
}

/**
 * review-session-v1 target-Skill selection + ordering (TD-126). Pure/deterministic — no I/O.
 * Select A iff ActivitySkill(A, target) OR (A has zero ActivitySkill AND LessonSkill(lesson, target)) — §23.
 * The LessonSkill fallback applies ONLY to activities with no ActivitySkill at all (§24 explicit override).
 * Order: direct-trigger selected first (§26), then Activity.position, then id. Returns ordered activityIds.
 */
export function selectReviewActivities(activities: SelectionActivity[], lessonHasTargetLessonSkill: boolean, triggerActivityIds: string[]): string[] {
  const trigger = new Set(triggerActivityIds);
  const selected = activities.filter((a) => a.attributedToTarget || (!a.hasAnyActivitySkill && lessonHasTargetLessonSkill));
  return selected
    .sort(
      (a, b) =>
        Number(trigger.has(b.activityId)) - Number(trigger.has(a.activityId)) || // direct-trigger first
        a.position - b.position ||
        a.activityId.localeCompare(b.activityId),
    )
    .map((a) => a.activityId);
}
