import { ActivityPayloadInvalidError } from '../../common/errors';
import { validateChoiceQuestionBody } from '../../common/payload/choice-question-payload';

/**
 * lesson-activity-objective/v1 (TD-108/109) — ACCEPTED objective Activity payload contract for LESSON
 * activities. SEPARATE domain from AssessmentItem's PLACEMENT_ITEM_V1 (§1/20): its own schemaVersion,
 * error type (ActivityPayloadInvalidError), and learner projection. It shares ONLY the neutral low-level
 * choice-structure primitive (`validateChoiceQuestionBody`, TD-246 §12), not any domain identity.
 * Application JSON is camelCase (§4/37).
 *
 * The `answerKey` is SERVER-ONLY — projectActivityForLearner() strips it; it must never reach HTTP (§10).
 */
export const LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION = 'lesson-activity-objective/v1';

/**
 * Objective ActivityType classification (§2/11) is owned by the canonical Activity registry (TD-246).
 * Re-exported here as a COMPATIBILITY SURFACE so existing importers keep working; the single source of
 * truth is src/content/activity/activity-registry.ts — this file defines no classification literal.
 */
export { OBJECTIVE_ACTIVITY_TYPES, isObjectiveActivityType } from '../../content/activity/activity-registry';

export type ObjectiveActivityFormat = 'single_choice' | 'multiple_choice' | 'true_false';

export interface ObjectiveOption {
  id: string;
  text: string;
}

export interface ObjectiveActivityPayload {
  schemaVersion: string;
  format: ObjectiveActivityFormat;
  prompt: string;
  options: ObjectiveOption[];
  answerKey: { correctOptionIds: string[] }; // SERVER-ONLY
}

/** Learner-facing projection — no answerKey, no correctness. */
export interface LearnerFacingActivity {
  id: string;
  type: string;
  position: number;
  format: ObjectiveActivityFormat;
  prompt: string;
  options: ObjectiveOption[];
}

function fail(): never {
  // Generic — never leak payload/answer-key values (§38).
  throw new ActivityPayloadInvalidError('activity payload invalid');
}

/**
 * Validate + normalize a raw objective Activity payload (§5-8). Fails safe on any malformed shape.
 * Checks the lesson schemaVersion + choice format here, then delegates the structural rules to the shared
 * choice-question primitive (TD-246 §12), passing this domain's `fail` so ActivityPayloadInvalidError is
 * still the thrown type. single_choice / true_false → exactly one correct; true_false → exactly two options;
 * multiple_choice → one or more correct. Unique non-empty option ids; every correct id an existing option.
 */
export function parseObjectiveActivityPayload(raw: unknown): ObjectiveActivityPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION) fail();
  const format = p.format as ObjectiveActivityFormat;
  if (format !== 'single_choice' && format !== 'multiple_choice' && format !== 'true_false') fail();

  const v = validateChoiceQuestionBody(format, p.prompt, p.options, p.answerKey, fail);
  return { schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: v.format, prompt: v.prompt, options: v.options, answerKey: { correctOptionIds: v.correctOptionIds } };
}

/** Strip everything server-only; expose only what a learner needs to render (§10/34). */
export function projectActivityForLearner(id: string, type: string, position: number, payload: ObjectiveActivityPayload): LearnerFacingActivity {
  return { id, type, position, format: payload.format, prompt: payload.prompt, options: payload.options.map((o) => ({ id: o.id, text: o.text })) };
}
