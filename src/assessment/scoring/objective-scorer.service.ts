import { Injectable } from '@nestjs/common';
import { AssessmentInvalidResponseError } from '../../common/errors';
import { PlacementItemPayload, isObjectiveFormat } from './item-payload';

/**
 * Backend is the sole scoring authority (§25/26). The client sends ONLY the learner answer (camelCase
 * JSON — OD/§2); it never sends (and can never influence) score/isCorrect/points. Scoring is
 * deterministic and the answer key stays server-side (never serialized).
 *
 * Score convention (TD-89 basis points): 10000 = fully correct, 0 = incorrect. No partial credit.
 */
export interface ObjectiveScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000 (TD-89)
}

const CORRECT_BP = 10000;
const INCORRECT_BP = 0;

@Injectable()
export class ObjectiveScorerService {
  /**
   * Score one objective answer. Normalization is TYPE-SPECIFIC (§27) — canonical option-id
   * comparison, never a blanket String().trim().toLowerCase(). Malformed shapes, unknown option ids,
   * DUPLICATE option ids, or extra fields are rejected as invalid responses (§3/26/57).
   */
  score(payload: PlacementItemPayload, answer: unknown): ObjectiveScore {
    if (!isObjectiveFormat(payload.format) || !payload.options || !payload.answerKey) {
      throw new AssessmentInvalidResponseError('item is not objectively scorable');
    }
    const optionIds = new Set(payload.options.map((o) => o.id));
    const correct = new Set(payload.answerKey.correctOptionIds);

    if (payload.format === 'single_choice' || payload.format === 'true_false') {
      const selected = this.readSelectedOptionId(answer, optionIds);
      const isCorrect = correct.has(selected) && correct.size === 1;
      return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
    }

    // multiple_choice — exact set match; duplicates are malformed, not silently canonicalized (§3).
    const selected = this.readSelectedOptionIds(answer, optionIds);
    const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
    return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
  }

  /**
   * Stable canonical form of a (validated) answer, for immutable-response replay comparison (§5).
   * Order-independent for multiple-choice; validates the answer (throws on malformed input).
   */
  canonicalize(payload: PlacementItemPayload, answer: unknown): string {
    if (!isObjectiveFormat(payload.format) || !payload.options) throw new AssessmentInvalidResponseError('item is not objectively scorable');
    const optionIds = new Set(payload.options.map((o) => o.id));
    if (payload.format === 'multiple_choice') {
      const set = this.readSelectedOptionIds(answer, optionIds);
      return 'mc:' + [...set].sort().join(',');
    }
    return 'sc:' + this.readSelectedOptionId(answer, optionIds);
  }

  private readSelectedOptionId(answer: unknown, optionIds: ReadonlySet<string>): string {
    if (answer === null || typeof answer !== 'object') throw new AssessmentInvalidResponseError('malformed answer');
    const keys = Object.keys(answer);
    if (keys.length !== 1 || keys[0] !== 'selectedOptionId') throw new AssessmentInvalidResponseError('unexpected answer fields');
    const id = (answer as Record<string, unknown>).selectedOptionId;
    if (typeof id !== 'string' || !optionIds.has(id)) throw new AssessmentInvalidResponseError('unknown option');
    return id;
  }

  private readSelectedOptionIds(answer: unknown, optionIds: ReadonlySet<string>): Set<string> {
    if (answer === null || typeof answer !== 'object') throw new AssessmentInvalidResponseError('malformed answer');
    const keys = Object.keys(answer);
    if (keys.length !== 1 || keys[0] !== 'selectedOptionIds') throw new AssessmentInvalidResponseError('unexpected answer fields');
    const arr = (answer as Record<string, unknown>).selectedOptionIds;
    if (!Array.isArray(arr) || arr.length === 0) throw new AssessmentInvalidResponseError('empty selection');
    const set = new Set<string>();
    for (const id of arr) {
      if (typeof id !== 'string' || !optionIds.has(id)) throw new AssessmentInvalidResponseError('unknown option');
      if (set.has(id)) throw new AssessmentInvalidResponseError('duplicate option'); // ["A","A"] is malformed (§3)
      set.add(id);
    }
    return set;
  }
}
