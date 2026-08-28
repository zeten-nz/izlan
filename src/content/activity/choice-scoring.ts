import { ActivityInvalidResponseError } from '../../common/errors';
import type { ObjectiveActivityPayload } from '../../lesson-execution/activity/objective-activity-payload';

/**
 * Pure exact-match scoring for the choice objective contract (lesson-activity-objective/v1) — extracted so the V1
 * `ObjectiveActivityScorerService` and the V2 interaction dispatcher share ONE implementation (no divergence).
 * Deterministic basis points: 10000 correct / 0 incorrect, no partial credit, no AI. Malformed learner answers
 * throw ActivityInvalidResponseError (never leak option/answerKey values).
 */
export interface DeterministicScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000
}

const CORRECT_BP = 10000;
const INCORRECT_BP = 0;

export function scoreChoice(payload: ObjectiveActivityPayload, answer: unknown): DeterministicScore {
  const optionIds = new Set(payload.options.map((o) => o.id));
  const correct = new Set(payload.answerKey.correctOptionIds);
  if (payload.format === 'single_choice' || payload.format === 'true_false') {
    const selected = readSelectedOptionId(answer, optionIds);
    const isCorrect = correct.has(selected) && correct.size === 1;
    return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
  }
  const selected = readSelectedOptionIds(answer, optionIds);
  const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
  return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
}

export function canonicalizeChoice(payload: ObjectiveActivityPayload, answer: unknown): string {
  const optionIds = new Set(payload.options.map((o) => o.id));
  if (payload.format === 'multiple_choice') return 'mc:' + [...readSelectedOptionIds(answer, optionIds)].sort().join(',');
  return 'sc:' + readSelectedOptionId(answer, optionIds);
}

function readSelectedOptionId(answer: unknown, optionIds: ReadonlySet<string>): string {
  if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== 'selectedOptionId') throw new ActivityInvalidResponseError('unexpected answer fields');
  const id = (answer as Record<string, unknown>).selectedOptionId;
  if (typeof id !== 'string' || !optionIds.has(id)) throw new ActivityInvalidResponseError('unknown option');
  return id;
}

function readSelectedOptionIds(answer: unknown, optionIds: ReadonlySet<string>): Set<string> {
  if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== 'selectedOptionIds') throw new ActivityInvalidResponseError('unexpected answer fields');
  const arr = (answer as Record<string, unknown>).selectedOptionIds;
  if (!Array.isArray(arr) || arr.length === 0) throw new ActivityInvalidResponseError('empty selection');
  const set = new Set<string>();
  for (const id of arr) {
    if (typeof id !== 'string' || !optionIds.has(id)) throw new ActivityInvalidResponseError('unknown option');
    if (set.has(id)) throw new ActivityInvalidResponseError('duplicate option');
    set.add(id);
  }
  return set;
}
