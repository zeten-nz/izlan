import { Injectable } from '@nestjs/common';
import { ObjectiveActivityPayload } from './objective-activity-payload';
import { scoreChoice, canonicalizeChoice } from '../../content/activity/choice-scoring';

/**
 * Backend is the sole scoring authority for objective (choice) Lesson activities (§9/21). The client sends ONLY the
 * camelCase answer; never score/isCorrect/points. Exact-match scoring (TD-89 basis points): 10000 correct / 0
 * incorrect — no partial credit, no AI. Delegates to the shared pure `choice-scoring` primitives so V1 lesson
 * execution and the V2 structured-activity interaction dispatcher score choice identically.
 */
export interface ObjectiveScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000
}

@Injectable()
export class ObjectiveActivityScorerService {
  score(payload: ObjectiveActivityPayload, answer: unknown): ObjectiveScore {
    return scoreChoice(payload, answer);
  }

  /** Stable canonical form of a (validated) answer for idempotent-retry / conflict comparison (§17/18). */
  canonicalize(payload: ObjectiveActivityPayload, answer: unknown): string {
    return canonicalizeChoice(payload, answer);
  }
}
