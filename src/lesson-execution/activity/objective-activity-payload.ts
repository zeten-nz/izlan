import { ActivityType } from '@prisma/client';
import { ActivityPayloadInvalidError } from '../../common/errors';

/**
 * lesson-activity-objective/v1 (TD-108/109) — ACCEPTED objective Activity payload contract for LESSON
 * activities. SEPARATE domain from AssessmentItem's PLACEMENT_ITEM_V1 (§1/20): the parser is its own,
 * even though the option/scoring primitives are analogous. Application JSON is camelCase (§4/37).
 *
 * The `answerKey` is SERVER-ONLY — projectActivityForLearner() strips it; it must never reach HTTP (§10).
 */
export const LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION = 'lesson-activity-objective/v1';

/** ActivityTypes that carry the objective contract and support attempt submission (§2/11). */
export const OBJECTIVE_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set([ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]);

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

export function isObjectiveActivityType(type: ActivityType): boolean {
  return OBJECTIVE_ACTIVITY_TYPES.has(type);
}

function fail(): never {
  // Generic — never leak payload/answer-key values (§38).
  throw new ActivityPayloadInvalidError('activity payload invalid');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate + normalize a raw objective Activity payload (§5-8). Fails safe on any malformed shape.
 * single_choice / true_false → exactly one correct; true_false → exactly two options;
 * multiple_choice → one or more correct. Unique non-empty option ids; every correct id an existing option.
 */
export function parseObjectiveActivityPayload(raw: unknown): ObjectiveActivityPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION) fail();
  if (!isNonEmptyString(p.prompt)) fail();
  const format = p.format as ObjectiveActivityFormat;
  if (format !== 'single_choice' && format !== 'multiple_choice' && format !== 'true_false') fail();

  if (!Array.isArray(p.options) || p.options.length < 2) fail();
  if (format === 'true_false' && p.options.length !== 2) fail();
  const options: ObjectiveOption[] = [];
  const ids = new Set<string>();
  for (const o of p.options) {
    if (o === null || typeof o !== 'object') fail();
    const oo = o as Record<string, unknown>;
    if (!isNonEmptyString(oo.id) || typeof oo.text !== 'string') fail();
    if (ids.has(oo.id)) fail(); // duplicate option id
    ids.add(oo.id);
    options.push({ id: oo.id, text: oo.text });
  }

  const ak = p.answerKey;
  if (ak === null || typeof ak !== 'object') fail();
  const correct = (ak as Record<string, unknown>).correctOptionIds;
  if (!Array.isArray(correct) || correct.length === 0) fail();
  const correctSet = new Set<string>();
  for (const cid of correct) {
    if (typeof cid !== 'string' || !ids.has(cid)) fail(); // correct id must be an existing option
    correctSet.add(cid);
  }
  if ((format === 'single_choice' || format === 'true_false') && correctSet.size !== 1) fail();

  return { schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format, prompt: p.prompt, options, answerKey: { correctOptionIds: [...correctSet] } };
}

/** Strip everything server-only; expose only what a learner needs to render (§10/34). */
export function projectActivityForLearner(id: string, type: string, position: number, payload: ObjectiveActivityPayload): LearnerFacingActivity {
  return { id, type, position, format: payload.format, prompt: payload.prompt, options: payload.options.map((o) => ({ id: o.id, text: o.text })) };
}
