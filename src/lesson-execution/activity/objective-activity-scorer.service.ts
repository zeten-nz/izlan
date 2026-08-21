import { Injectable } from '@nestjs/common';
import { ActivityInvalidResponseError } from '../../common/errors';
import { ObjectiveActivityPayload } from './objective-activity-payload';

/**
 * Backend is the sole scoring authority for objective Lesson activities (§9/21). The client sends ONLY the
 * camelCase answer; never score/isCorrect/points. Exact-match scoring (TD-89 basis points): 10000 correct /
 * 0 incorrect — no partial credit, no AI. `canonicalize` gives a stable form for idempotent-retry comparison.
 */
export interface ObjectiveScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000
}

const CORRECT_BP = 10000;
const INCORRECT_BP = 0;

@Injectable()
export class ObjectiveActivityScorerService {
  score(payload: ObjectiveActivityPayload, answer: unknown): ObjectiveScore {
    const optionIds = new Set(payload.options.map((o) => o.id));
    const correct = new Set(payload.answerKey.correctOptionIds);

    if (payload.format === 'single_choice' || payload.format === 'true_false') {
      const selected = this.readSelectedOptionId(answer, optionIds);
      const isCorrect = correct.has(selected) && correct.size === 1;
      return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
    }
    // multiple_choice — exact set match; duplicates are malformed, not silently deduped (§8/27).
    const selected = this.readSelectedOptionIds(answer, optionIds);
    const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
    return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP };
  }

  /** Stable canonical form of a (validated) answer for idempotent-retry / conflict comparison (§17/18). */
  canonicalize(payload: ObjectiveActivityPayload, answer: unknown): string {
    const optionIds = new Set(payload.options.map((o) => o.id));
    if (payload.format === 'multiple_choice') {
      return 'mc:' + [...this.readSelectedOptionIds(answer, optionIds)].sort().join(',');
    }
    return 'sc:' + this.readSelectedOptionId(answer, optionIds);
  }

  private readSelectedOptionId(answer: unknown, optionIds: ReadonlySet<string>): string {
    if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
    const keys = Object.keys(answer);
    if (keys.length !== 1 || keys[0] !== 'selectedOptionId') throw new ActivityInvalidResponseError('unexpected answer fields');
    const id = (answer as Record<string, unknown>).selectedOptionId;
    if (typeof id !== 'string' || !optionIds.has(id)) throw new ActivityInvalidResponseError('unknown option');
    return id;
  }

  private readSelectedOptionIds(answer: unknown, optionIds: ReadonlySet<string>): Set<string> {
    if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
    const keys = Object.keys(answer);
    if (keys.length !== 1 || keys[0] !== 'selectedOptionIds') throw new ActivityInvalidResponseError('unexpected answer fields');
    const arr = (answer as Record<string, unknown>).selectedOptionIds;
    if (!Array.isArray(arr) || arr.length === 0) throw new ActivityInvalidResponseError('empty selection');
    const set = new Set<string>();
    for (const id of arr) {
      if (typeof id !== 'string' || !optionIds.has(id)) throw new ActivityInvalidResponseError('unknown option');
      if (set.has(id)) throw new ActivityInvalidResponseError('duplicate option'); // ["A","A"] invalid (§8/27)
      set.add(id);
    }
    return set;
  }
}
