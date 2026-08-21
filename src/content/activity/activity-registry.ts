import { ActivityType } from '@prisma/client';

/**
 * Canonical Lesson Activity registry (activity-registry-v1, TD-246) — the ONE source of truth for how the
 * learner runtime classifies each Prisma `ActivityType`. Before this, the objective/view-only sets were
 * duplicated literally across the payload parser, completion eligibility, and daily-mission code; this
 * registry replaces every one of those runtime classification sets (§2/9/10/21).
 *
 * SCOPE (Phase 2.2A-R): this registry describes CURRENT runtime-v1 behavior EXACTLY — it invents no new
 * capability. View-only / deferred types have NO accepted Activity payload contract yet (payloadContract =
 * NONE_DEFINED, §13); the future authoring backend (2.2A) will consume this registry and define those.
 *
 * DOMAIN BOUNDARY: this is the LESSON Activity domain only. AssessmentItem (`placement-item/v1`) is a
 * SEPARATE versioned contract and is deliberately NOT modelled here (§3/12).
 *
 * Pure module — no Nest, no DB, no HTTP. A future HTTP/authoring layer imports it; it imports nothing runtime.
 */

/** How the learner runtime executes an Activity. */
export type ActivityExecutionKind = 'OBJECTIVE' | 'VIEW_ONLY' | 'UNSUPPORTED';

/** What counts as "performed" for lesson-completion eligibility (lesson-completion-v1, §10). */
export type ActivityCompletionEvidence = 'SUBMITTED_ATTEMPT' | 'COMPLETED_ACTIVITY' | 'UNSUPPORTED';

/** Whether the backend deterministically scores attempts on this Activity (§11). */
export type ActivityScoringCapability = 'DETERMINISTIC_OBJECTIVE' | 'NONE';

/** How much of the Activity may be projected to a learner (§8). */
export type ActivityLearnerProjection = 'OBJECTIVE_SAFE' | 'METADATA_ONLY';

/** The accepted Activity payload contract, if any. NONE_DEFINED = no accepted shape in this phase (§13). */
export type ActivityPayloadContract = 'LESSON_OBJECTIVE_V1' | 'NONE_DEFINED';

export interface ActivityDefinition {
  type: ActivityType;
  executionKind: ActivityExecutionKind;
  completionEvidence: ActivityCompletionEvidence;
  scoring: ActivityScoringCapability;
  learnerProjection: ActivityLearnerProjection;
  payloadContract: ActivityPayloadContract;
}

const OBJECTIVE = (type: ActivityType): ActivityDefinition => ({
  type,
  executionKind: 'OBJECTIVE',
  completionEvidence: 'SUBMITTED_ATTEMPT',
  scoring: 'DETERMINISTIC_OBJECTIVE',
  learnerProjection: 'OBJECTIVE_SAFE',
  payloadContract: 'LESSON_OBJECTIVE_V1',
});

const VIEW_ONLY = (type: ActivityType): ActivityDefinition => ({
  type,
  executionKind: 'VIEW_ONLY',
  completionEvidence: 'COMPLETED_ACTIVITY',
  scoring: 'NONE',
  learnerProjection: 'METADATA_ONLY',
  payloadContract: 'NONE_DEFINED',
});

const UNSUPPORTED = (type: ActivityType): ActivityDefinition => ({
  type,
  executionKind: 'UNSUPPORTED',
  completionEvidence: 'UNSUPPORTED',
  scoring: 'NONE',
  learnerProjection: 'METADATA_ONLY',
  payloadContract: 'NONE_DEFINED',
});

/**
 * Every Prisma `ActivityType` classified EXACTLY ONCE. `Record<ActivityType, …>` gives COMPILE-TIME
 * exhaustiveness: adding an enum value without a row here fails `tsc`. The AR-01 unit test is the runtime
 * backstop. Classification mirrors current runtime-v1 (VIDEO stays deferred — not view-only, §4).
 */
export const ACTIVITY_REGISTRY: Readonly<Record<ActivityType, ActivityDefinition>> = {
  // objective — carry lesson-activity-objective/v1, accept attempt submission, deterministically scored
  [ActivityType.MINI_QUESTION]: OBJECTIVE(ActivityType.MINI_QUESTION),
  [ActivityType.PRACTICE]: OBJECTIVE(ActivityType.PRACTICE),
  [ActivityType.MASTERY_TEST]: OBJECTIVE(ActivityType.MASTERY_TEST),
  // view-only — completed by explicit learner acknowledgement; metadata-only projection; no payload contract yet
  [ActivityType.TEXT]: VIEW_ONLY(ActivityType.TEXT),
  [ActivityType.EXPLANATION]: VIEW_ONLY(ActivityType.EXPLANATION),
  [ActivityType.IMAGE]: VIEW_ONLY(ActivityType.IMAGE),
  [ActivityType.AUDIO]: VIEW_ONLY(ActivityType.AUDIO),
  [ActivityType.EXAMPLE]: VIEW_ONLY(ActivityType.EXAMPLE),
  // deferred — not supported by learner runtime v1 (completion cannot authoritatively record them)
  [ActivityType.SPEAKING]: UNSUPPORTED(ActivityType.SPEAKING),
  [ActivityType.WRITING]: UNSUPPORTED(ActivityType.WRITING),
  [ActivityType.LISTENING]: UNSUPPORTED(ActivityType.LISTENING),
  [ActivityType.AI_INTERACTION]: UNSUPPORTED(ActivityType.AI_INTERACTION),
  [ActivityType.VIDEO]: UNSUPPORTED(ActivityType.VIDEO),
};

/** The canonical definition for a type. Total over the enum (never undefined for a valid ActivityType). */
export function getActivityDefinition(type: ActivityType): ActivityDefinition {
  return ACTIVITY_REGISTRY[type];
}

export function isObjectiveActivityType(type: ActivityType): boolean {
  return ACTIVITY_REGISTRY[type].executionKind === 'OBJECTIVE';
}

export function isViewOnlyActivityType(type: ActivityType): boolean {
  return ACTIVITY_REGISTRY[type].executionKind === 'VIEW_ONLY';
}

export function isUnsupportedActivityType(type: ActivityType): boolean {
  return ACTIVITY_REGISTRY[type].executionKind === 'UNSUPPORTED';
}

const defsByKind = (kind: ActivityExecutionKind): ActivityType[] =>
  Object.values(ACTIVITY_REGISTRY)
    .filter((d) => d.executionKind === kind)
    .map((d) => d.type);

/** Objective ActivityTypes (MINI_QUESTION/PRACTICE/MASTERY_TEST) — derived, never a hand-maintained literal. */
export const OBJECTIVE_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set(defsByKind('OBJECTIVE'));

/** View-only ActivityTypes (TEXT/EXPLANATION/IMAGE/AUDIO/EXAMPLE) — derived. */
export const VIEW_ONLY_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set(defsByKind('VIEW_ONLY'));
