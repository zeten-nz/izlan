import { AssessmentConfigurationInvalidError } from '../../common/errors';

/**
 * PLACEMENT_ITEM_V1 — ACCEPTED technical contract for AssessmentItem.payload (class A, TD-22/92, OD/§2).
 *
 * Application/HTTP JSON is camelCase (OD/§2): learner answers are `{selectedOptionId}` (single/true_false)
 * and `{selectedOptionIds:[...]}` (multiple_choice). The stale conceptual `selected_option_id`
 * (DATA_MODEL_LEARNING §12) was conceptual naming; the implementation contract is camelCase. DB column
 * naming policy (snake_case) is unchanged.
 *
 * The correct-answer key lives INSIDE the payload under `answerKey` and is SERVER-ONLY:
 * projectItemForLearner() strips it. It must never reach an HTTP response (§16/52).
 *
 * `open_ended` remains parseable for FUTURE engines but is NOT a placement-adaptive-v1 path — the
 * placement engine is OBJECTIVE-ONLY (§22): pool validation rejects non-objective formats before start.
 */

export const PLACEMENT_ITEM_SCHEMA_VERSION = 'placement-item/v1';

export type PlacementItemFormat = 'single_choice' | 'multiple_choice' | 'true_false' | 'open_ended';

const OBJECTIVE: ReadonlySet<PlacementItemFormat> = new Set(['single_choice', 'multiple_choice', 'true_false']);

export interface PlacementItemOption {
  id: string;
  text: string;
}

export interface PlacementItemPayload {
  schemaVersion: string;
  format: PlacementItemFormat;
  prompt: string;
  options?: PlacementItemOption[]; // choice / true_false only
  answerKey?: { correctOptionIds: string[] }; // SERVER-ONLY; absent for open_ended
}

/** Learner-facing projection — deliberately excludes answerKey, difficulty, skillId, provenance. */
export interface LearnerFacingItem {
  id: string;
  type: string;
  format: PlacementItemFormat;
  prompt: string;
  options?: PlacementItemOption[]; // ids + text only; NO correctness flags
}

export function isObjectiveFormat(f: PlacementItemFormat): boolean {
  return OBJECTIVE.has(f);
}

function fail(): never {
  throw new AssessmentConfigurationInvalidError('assessment item payload invalid');
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate + normalize a raw item payload. Fails safe (never trusts JSONB shape).
 * Choice/true_false: >=2 options with unique ids; answerKey a non-empty subset of option ids
 * (single_choice/true_false → exactly one correct; multiple_choice → one or more).
 * true_false: exactly two options. open_ended: no options, no answerKey.
 */
export function parseItemPayload(raw: unknown): PlacementItemPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== PLACEMENT_ITEM_SCHEMA_VERSION) fail();
  if (!isNonEmptyString(p.prompt)) fail();
  const format = p.format as PlacementItemFormat;
  if (format !== 'single_choice' && format !== 'multiple_choice' && format !== 'true_false' && format !== 'open_ended') fail();

  if (format === 'open_ended') {
    if (p.options !== undefined || p.answerKey !== undefined) fail();
    return { schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format, prompt: p.prompt };
  }

  // choice / true_false
  if (!Array.isArray(p.options) || p.options.length < 2) fail();
  if (format === 'true_false' && p.options.length !== 2) fail();
  const options: PlacementItemOption[] = [];
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
    if (typeof cid !== 'string' || !ids.has(cid)) fail(); // unknown correct id
    correctSet.add(cid);
  }
  if ((format === 'single_choice' || format === 'true_false') && correctSet.size !== 1) fail();

  return {
    schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION,
    format,
    prompt: p.prompt,
    options,
    answerKey: { correctOptionIds: [...correctSet] },
  };
}

/** Strip everything server-only; return only what a learner needs to render the question (§16). */
export function projectItemForLearner(itemId: string, type: string, payload: PlacementItemPayload): LearnerFacingItem {
  const base: LearnerFacingItem = { id: itemId, type, format: payload.format, prompt: payload.prompt };
  if (payload.options) base.options = payload.options.map((o) => ({ id: o.id, text: o.text }));
  return base; // answerKey intentionally never copied
}
