import { ActivityPayloadInvalidError } from '../../common/errors';
import { parseObjectiveActivityPayload, projectActivityForLearner, type ObjectiveActivityPayload, LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../../lesson-execution/activity/objective-activity-payload';
import { scoreChoice, canonicalizeChoice } from './choice-scoring';
import { parseStructuredActivityPayload, projectStructuredForLearner, LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION, type StructuredActivityPayload } from './structured-activity-payload';
import { scoreStructured, canonicalizeStructured, type StructuredFeedback } from './structured-activity-scorer';
import { evidenceForActivity, type ActivityEvidence, type ActivityInteractionKind } from './activity-evidence';

/**
 * ONE deterministic interaction engine over every scorable activity payload family — the single place teaching,
 * review and lesson runtime parse → score → canonicalize → project → derive-evidence, dispatching purely on the
 * payload's `schemaVersion`. Choice (lesson-activity-objective/v1) and structured production
 * (lesson-activity-structured/v1) both flow through here; a new family is added by one branch, never a new engine.
 *
 * Pure module — no Nest/DB/HTTP. answerKey/accepted-answers never survive projection.
 */
export type InteractiveActivity =
  | { kind: 'CHOICE'; payload: ObjectiveActivityPayload }
  | { kind: 'STRUCTURED'; payload: StructuredActivityPayload };

export interface InteractiveScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000
  feedback?: StructuredFeedback; // structured formats carry learner-safe feedback; choice has none
}

/** True if a raw stored payload is a scorable interactive activity (choice or structured). */
export function isInteractiveSchema(raw: unknown): boolean {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  return v === LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION || v === LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION;
}

/** Validate + normalize a raw payload into a typed interactive activity. Throws ActivityPayloadInvalidError if unknown. */
export function parseInteractiveActivity(raw: unknown): InteractiveActivity {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (v === LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION) return { kind: 'CHOICE', payload: parseObjectiveActivityPayload(raw) };
  if (v === LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION) return { kind: 'STRUCTURED', payload: parseStructuredActivityPayload(raw) };
  throw new ActivityPayloadInvalidError('activity payload invalid');
}

export function scoreInteractive(activity: InteractiveActivity, answer: unknown): InteractiveScore {
  if (activity.kind === 'CHOICE') return scoreChoice(activity.payload, answer);
  return scoreStructured(activity.payload, answer);
}

export function canonicalizeInteractive(activity: InteractiveActivity, answer: unknown): string {
  return activity.kind === 'CHOICE' ? canonicalizeChoice(activity.payload, answer) : canonicalizeStructured(activity.payload, answer);
}

/** The honest evidence this activity produces (recognition@1 for choice; controlled-production@2 for structured). */
export function interactiveEvidence(activity: InteractiveActivity): ActivityEvidence {
  return evidenceForActivity(activity.kind as ActivityInteractionKind);
}

/** Learner-safe projection (answerKey/accepted sets stripped) for a parsed interactive activity. */
export function projectInteractiveForLearner(id: string, type: string, position: number, activity: InteractiveActivity) {
  return activity.kind === 'CHOICE'
    ? projectActivityForLearner(id, type, position, activity.payload)
    : projectStructuredForLearner(id, type, position, activity.payload);
}

/** The interaction family of a raw stored payload, or null if it is not an interactive activity. */
export function interactionKindOf(raw: unknown): ActivityInteractionKind | null {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (v === LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION) return 'CHOICE';
  if (v === LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION) return 'STRUCTURED';
  return null;
}
