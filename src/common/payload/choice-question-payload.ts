/**
 * choice-question structural primitive (Phase 2.2A-R, §12) — a NEUTRAL, domain-agnostic validator for the
 * body of a choice / true_false question. It knows NOTHING about schemaVersion, error classes, learner
 * projections, `open_ended`, lifecycle, or which domain called it.
 *
 * Two domains share the SAME low-level structural rules but remain SEPARATE public contracts:
 *   - Lesson `lesson-activity-objective/v1`  (src/lesson-execution/activity/objective-activity-payload.ts)
 *   - Assessment `placement-item/v1`         (src/assessment/scoring/item-payload.ts)
 *
 * Each domain wrapper checks its OWN schemaVersion/format policy, then delegates the structural rules here,
 * passing its OWN `fail` so the thrown error TYPE stays domain-specific (ActivityPayloadInvalidError vs
 * AssessmentConfigurationInvalidError). This eliminates the duplicated structural logic WITHOUT collapsing
 * the two domain contracts (§3/12). This primitive owns no domain identity and must never grow one.
 */

export type ChoiceQuestionFormat = 'single_choice' | 'multiple_choice' | 'true_false';

export interface ChoiceOption {
  id: string;
  text: string;
}

export interface ValidatedChoiceQuestion {
  format: ChoiceQuestionFormat;
  prompt: string;
  options: ChoiceOption[];
  correctOptionIds: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate + normalize a raw choice-question body. Fails safe (never trusts JSONB shape). The caller has
 * already established the format is one of the three choice formats and matched its own schemaVersion.
 *
 * Rules (identical across both domains, unchanged from the prior in-domain implementations):
 *   - prompt: non-empty string
 *   - options: array, length >= 2; true_false → exactly 2
 *   - each option: object with a non-empty string `id` and a string `text`; ids unique
 *   - answerKey.correctOptionIds: non-empty array; every id an existing option id
 *   - single_choice / true_false → exactly one correct
 *
 * `fail` is the caller's domain error thrower — invoked (never returns) on any violation, so the error
 * IDENTITY belongs to the calling domain. The generic message never leaks payload/answer-key values (§38).
 */
export function validateChoiceQuestionBody(
  format: ChoiceQuestionFormat,
  rawPrompt: unknown,
  rawOptions: unknown,
  rawAnswerKey: unknown,
  fail: () => never,
): ValidatedChoiceQuestion {
  if (!isNonEmptyString(rawPrompt)) fail();

  if (!Array.isArray(rawOptions) || rawOptions.length < 2) fail();
  if (format === 'true_false' && rawOptions.length !== 2) fail();
  const options: ChoiceOption[] = [];
  const ids = new Set<string>();
  for (const o of rawOptions) {
    if (o === null || typeof o !== 'object') fail();
    const oo = o as Record<string, unknown>;
    if (!isNonEmptyString(oo.id) || typeof oo.text !== 'string') fail();
    if (ids.has(oo.id)) fail(); // duplicate option id
    ids.add(oo.id);
    options.push({ id: oo.id, text: oo.text });
  }

  if (rawAnswerKey === null || typeof rawAnswerKey !== 'object') fail();
  const correct = (rawAnswerKey as Record<string, unknown>).correctOptionIds;
  if (!Array.isArray(correct) || correct.length === 0) fail();
  const correctSet = new Set<string>();
  for (const cid of correct) {
    if (typeof cid !== 'string' || !ids.has(cid)) fail(); // correct id must be an existing option
    correctSet.add(cid);
  }
  if ((format === 'single_choice' || format === 'true_false') && correctSet.size !== 1) fail();

  return { format, prompt: rawPrompt, options, correctOptionIds: [...correctSet] };
}
