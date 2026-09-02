import { ActivityPayloadInvalidError } from '../../common/errors';
import { validateChoiceQuestionBody } from '../../common/payload/choice-question-payload';
import type { ObjectiveOption } from '../../lesson-execution/activity/objective-activity-payload';

/**
 * lesson-activity-reading/v1 — an honest first-generation READING comprehension activity: a short, learner-VISIBLE
 * text `passage` (the stimulus the learner must read — e.g. a profile, a menu, a timetable, a room description)
 * followed by an objective comprehension question scored deterministically (single_choice). Because the answer can
 * only be derived by reading the passage, it emits reading-comprehension evidence — NOT grammar recognition.
 *
 * Mirrors the listening contract's discipline, but the stimulus is INLINE text (projected to the learner) rather than
 * relational audio: there is no MediaAsset and no hidden transcript. Its comprehension body reuses the neutral choice
 * primitive, so it is scored/canonicalized by the shared choice scorer. The `answerKey` is SERVER-ONLY and is never
 * projected to the learner; the `passage` + `prompt` + `options` ARE projected (the passage is meant to be read).
 */
export const LESSON_ACTIVITY_READING_SCHEMA_VERSION = 'lesson-activity-reading/v1';

/** Reasonable A1 bound so a "reading" stimulus stays a short readable text, not an essay. */
const MAX_PASSAGE_LEN = 1200;

export interface ReadingActivityPayload {
  schemaVersion: string;
  format: 'reading_comprehension';
  passage: string; // learner-VISIBLE stimulus text
  prompt: string;
  options: ObjectiveOption[];
  answerKey: { correctOptionIds: string[] }; // SERVER-ONLY
}

/** Learner-facing projection — the passage IS shown (it is the reading stimulus); the answerKey is stripped. */
export interface LearnerReadingActivity {
  id: string;
  type: string;
  position: number;
  schemaVersion: string;
  format: 'reading_comprehension';
  passage: string;
  prompt: string;
  options: ObjectiveOption[];
}

function fail(): never {
  throw new ActivityPayloadInvalidError('activity payload invalid'); // generic — never leak payload/answerKey values
}

export function isReadingSchema(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).schemaVersion === LESSON_ACTIVITY_READING_SCHEMA_VERSION;
}

export function parseReadingActivityPayload(raw: unknown): ReadingActivityPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_READING_SCHEMA_VERSION) fail();
  if (p.format !== 'reading_comprehension') fail();
  if (typeof p.passage !== 'string' || p.passage.trim().length === 0 || p.passage.length > MAX_PASSAGE_LEN) fail();
  // The comprehension question is a single_choice body (deterministic) validated by the shared primitive.
  const v = validateChoiceQuestionBody('single_choice', p.prompt, p.options, p.answerKey, fail);
  return { schemaVersion: LESSON_ACTIVITY_READING_SCHEMA_VERSION, format: 'reading_comprehension', passage: p.passage, prompt: v.prompt, options: v.options, answerKey: { correctOptionIds: v.correctOptionIds } };
}

/** Strip the answerKey; the learner receives the passage (to read) + the prompt + options. */
export function projectReadingForLearner(id: string, type: string, position: number, payload: ReadingActivityPayload): LearnerReadingActivity {
  return { id, type, position, schemaVersion: payload.schemaVersion, format: 'reading_comprehension', passage: payload.passage, prompt: payload.prompt, options: payload.options.map((o) => ({ id: o.id, text: o.text })) };
}
