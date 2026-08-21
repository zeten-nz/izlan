import { ActivityAttemptStatus, ActivityType } from '@prisma/client';
import { isObjectiveActivityType } from '../../content/activity/activity-registry';

/** Overall accepted policy identifier (TD-136). Producer versions are immutable; changes ship as v2. */
export const DAILY_MISSIONS_VERSION = 'daily-missions-v1';

export const LEARN_TODAY = 'LEARN_TODAY';
export const MASTERY_TEST_90 = 'MASTERY_TEST_90';
export const LEARN_TODAY_VERSION = 'learn-today-mission-v1';
export const MASTERY_TEST_90_VERSION = 'mastery-test-90-mission-v1';
export const MASTERY_TEST_90_THRESHOLD_BP = 9000; // 90% on the basis-point scale (TD-89)

/** Normalized mission evidence — one objective ActivityAttempt. No raw answer/payload (§78). */
export interface MissionEvidence {
  attemptId: string;
  activityType: ActivityType;
  status: ActivityAttemptStatus;
  deterministicScoreBp: number | null;
  submittedAt: Date; // logical evidence time (§18)
  reviewSessionId: string | null; // normal (null) and review (non-null) both count (§9/13)
}

/** LEARN_TODAY (learn-today-mission-v1, TD-137): a SUBMITTED objective attempt. Correctness IRRELEVANT (§6). */
export function qualifiesLearnToday(e: MissionEvidence): boolean {
  return e.status === ActivityAttemptStatus.SUBMITTED && isObjectiveActivityType(e.activityType);
}

/** MASTERY_TEST_90 (mastery-test-90-mission-v1, TD-138): SUBMITTED MASTERY_TEST with deterministicScore >= 9000. */
export function qualifiesMasteryTest90(e: MissionEvidence): boolean {
  return e.status === ActivityAttemptStatus.SUBMITTED && e.activityType === ActivityType.MASTERY_TEST && (e.deterministicScoreBp ?? -1) >= MASTERY_TEST_90_THRESHOLD_BP;
}

export interface MissionSpec {
  code: string;
  version: string;
  qualifies: (e: MissionEvidence) => boolean;
}

/** The v1 mission catalog (server registry, §35/36 — no rule DSL). Deferred missions are not present (§84). */
export const MISSION_CATALOG: readonly MissionSpec[] = [
  { code: LEARN_TODAY, version: LEARN_TODAY_VERSION, qualifies: qualifiesLearnToday },
  { code: MASTERY_TEST_90, version: MASTERY_TEST_90_VERSION, qualifies: qualifiesMasteryTest90 },
];
