import { Injectable } from '@nestjs/common';
import { ReviewMasteryConfigurationInvalidError } from '../common/errors';
import { ReviewSessionRepository } from './review-session.repository';
import { deriveReviewMastery } from './mastery/review-mastery.engine';

export interface ReviewMasteryView {
  measured: boolean;
  skillId?: string;
  scoreBp?: number;
  confidenceBp?: number;
  evidenceCount?: number;
  displayLevel?: null;
}

/**
 * Review mastery producer (Phase 1.9C, TD-129/130). Normalizes a COMPLETED Review Session into ONE append-only
 * REVIEW_MASTERY SkillMeasurement (idempotent). It writes only SkillMeasurement — NOT LearnerSkillState
 * (LearningProgress single writer, TD-115) and NOT LearnerSignal. Downstream merge/signal recompute is
 * orchestrated by the caller.
 */
@Injectable()
export class ReviewMasteryService {
  constructor(private readonly repo: ReviewSessionRepository) {}

  /** Idempotently derive + persist the REVIEW_MASTERY milestone for an own COMPLETED session (§16/17/18). */
  async ensureDerived(userId: string, sessionId: string): Promise<ReviewMasteryView> {
    const session = await this.repo.sessionForMastery(sessionId);
    if (!session || session.userId !== userId || session.status !== 'COMPLETED' || !session.completedAt) return { measured: false }; // only COMPLETED (§16)

    const selected = await this.repo.selectedActivityIds(sessionId);
    if (selected.length === 0) throw new ReviewMasteryConfigurationInvalidError('no selected activity'); // §17
    const best = await this.repo.bestReviewScores(sessionId, selected);
    if (!selected.every((a) => best.has(a))) throw new ReviewMasteryConfigurationInvalidError('selected activity missing review evidence'); // §17

    const result = deriveReviewMastery(selected.map((a) => best.get(a) as number)); // pure (§10)
    await this.repo.createReviewMeasurement({
      userId,
      skillId: session.skillId,
      reviewSessionId: sessionId,
      scoreBp: result.scoreBp,
      confidenceBp: result.confidenceBp,
      evidenceCount: result.evidenceCount,
      observedAt: session.completedAt, // §14 logical milestone time
    });
    return { measured: true, skillId: session.skillId, scoreBp: result.scoreBp, confidenceBp: result.confidenceBp, evidenceCount: result.evidenceCount, displayLevel: null };
  }
}
