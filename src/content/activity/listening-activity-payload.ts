import { ActivityPayloadInvalidError } from '../../common/errors';
import { validateChoiceQuestionBody } from '../../common/payload/choice-question-payload';
import type { ObjectiveOption } from '../../lesson-execution/activity/objective-activity-payload';

/**
 * lesson-activity-listening/v1 — an honest first-generation LISTENING comprehension activity: a canonical AUDIO
 * stimulus (attached RELATIONALLY via ActivityMedia — never a URL in the payload) followed by an objective
 * comprehension question scored deterministically (single_choice). It is a scored objective activity whose FORMAT
 * marks it as listening, so it emits listening-comprehension evidence — never speaking/pronunciation. The audio must
 * be a READY MediaAsset before the activity can be published (enforced by publication readiness).
 *
 * Its comprehension body reuses the neutral choice primitive, so it is scored/canonicalized by the shared choice
 * scorer. The `answerKey` (+ an optional authoring `transcript`) is SERVER-ONLY and never projected to the learner.
 */
export const LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION = 'lesson-activity-listening/v1';

export interface ListeningActivityPayload {
  schemaVersion: string;
  format: 'listening_comprehension';
  prompt: string;
  options: ObjectiveOption[];
  answerKey: { correctOptionIds: string[] }; // SERVER-ONLY
  transcript?: string; // SERVER-ONLY authoring reference (never projected)
}

/** Learner-facing projection — the prompt + options, plus the marker so the client plays the attached audio first. */
export interface LearnerListeningActivity {
  id: string;
  type: string;
  position: number;
  schemaVersion: string;
  format: 'listening_comprehension';
  prompt: string;
  options: ObjectiveOption[];
}

function fail(): never {
  throw new ActivityPayloadInvalidError('activity payload invalid');
}

export function isListeningSchema(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).schemaVersion === LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION;
}

export function parseListeningActivityPayload(raw: unknown): ListeningActivityPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION) fail();
  if (p.format !== 'listening_comprehension') fail();
  if (p.transcript !== undefined && (typeof p.transcript !== 'string' || p.transcript.length === 0)) fail();
  // The comprehension question is a single_choice body (deterministic) validated by the shared primitive.
  const v = validateChoiceQuestionBody('single_choice', p.prompt, p.options, p.answerKey, fail);
  const out: ListeningActivityPayload = { schemaVersion: LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION, format: 'listening_comprehension', prompt: v.prompt, options: v.options, answerKey: { correctOptionIds: v.correctOptionIds } };
  if (typeof p.transcript === 'string') out.transcript = p.transcript;
  return out;
}

/** Strip the answerKey + transcript; the learner receives the prompt + options + (relationally) the audio. */
export function projectListeningForLearner(id: string, type: string, position: number, payload: ListeningActivityPayload): LearnerListeningActivity {
  return { id, type, position, schemaVersion: payload.schemaVersion, format: 'listening_comprehension', prompt: payload.prompt, options: payload.options.map((o) => ({ id: o.id, text: o.text })) };
}
