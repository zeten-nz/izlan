import { Injectable } from '@nestjs/common';
import { RoadmapPointNotFoundError } from '../common/errors';
import { ReviewSessionService } from '../review-session/review-session.service';
import { LearningCoreRepository } from './learning-core.repository';
import { V2RoadmapService, type V2RoadmapPointView } from './v2-roadmap.service';
import { type AttentionReasonCode } from './attention/point-attention.engine';

export const ADAPTATION_FOCUS_POLICY_VERSION = 'adaptation-focus-v1';

export type FocusAction = 'REPAIR' | 'REVIEW' | 'CONTINUE' | 'DONE';

export interface FocusView {
  action: FocusAction;
  policyVersion: string;
  point: { roadmapPointId: string; pointKey: string; title: string; activeSessionId: string | null } | null;
  skill: { id: string; name: string } | null; // the driving skill for REPAIR/REVIEW
  reason: AttentionReasonCode | null; // learner-facing reason category (mapped to copy in the UI)
}

/**
 * Adaptation surface — the "what is the most useful next learning action?" decision, and the point-scoped review
 * entry. Decides from CURRENT evidence (derived attention over the immutable acquisition + live signals), never
 * just the next numeric roadmap position. Owns no state: it reads the derived roadmap and delegates review to the
 * reused Review Session aggregate. History (acquisitions, generations) is never rewritten.
 */
@Injectable()
export class AdaptationService {
  constructor(
    private readonly repo: LearningCoreRepository,
    private readonly roadmap: V2RoadmapService,
    private readonly reviewSessions: ReviewSessionService,
  ) {}

  /** The single most useful next action: repair a real gap > refresh fading knowledge > continue learning > done. */
  async getFocus(userId: string, subjectId: string): Promise<FocusView> {
    const view = await this.roadmap.getRoadmap(userId, subjectId);
    const points = view.points;

    const repair = points.find((p) => p.attention === 'REPAIR_REQUIRED');
    if (repair) return this.attentionFocus('REPAIR', repair);

    const review = points.find((p) => p.attention === 'REVIEW_DUE');
    if (review) return this.attentionFocus('REVIEW', review);

    // Otherwise the next thing to learn: an available/in-progress point not yet acquired (evidence-ordered by the
    // roadmap's canonical sort, not a bare index).
    const cont = points.find((p) => (p.availability === 'AVAILABLE' || p.availability === 'IN_PROGRESS') && !p.learned && !p.validated);
    if (cont) {
      return { action: 'CONTINUE', policyVersion: ADAPTATION_FOCUS_POLICY_VERSION, point: pointRef(cont), skill: null, reason: null };
    }
    return { action: 'DONE', policyVersion: ADAPTATION_FOCUS_POLICY_VERSION, point: null, skill: null, reason: null };
  }

  private attentionFocus(action: 'REPAIR' | 'REVIEW', p: V2RoadmapPointView): FocusView {
    return { action, policyVersion: ADAPTATION_FOCUS_POLICY_VERSION, point: pointRef(p), skill: p.attentionSkill, reason: p.attentionReason };
  }

  /**
   * Start (or resume) a review session for one skill of an acquired point. Reuses the Review Session aggregate;
   * provenance records whichever attention signals are currently active for the skill (manual review — not yet
   * due — is allowed and simply carries no signal types). 404-safe: an unacquired / cross-user point resolves to
   * null → RoadmapPointNotFoundError, indistinguishable from a non-existent point.
   */
  async startPointReview(userId: string, pointId: string, skillId: string) {
    const target = await this.repo.resolvePointReviewTarget(userId, pointId, skillId);
    if (!target) throw new RoadmapPointNotFoundError('point not reviewable');
    const signalsBySkill = await this.repo.activeAttentionSignals(userId, target.subjectId);
    const signalTypes = signalsBySkill.get(skillId) ?? [];
    return this.reviewSessions.startForResolvedTarget(userId, { ...target, skillId, signalTypes });
  }
}

function pointRef(p: V2RoadmapPointView): { roadmapPointId: string; pointKey: string; title: string; activeSessionId: string | null } {
  return { roadmapPointId: p.roadmapPointId, pointKey: p.pointKey, title: p.title, activeSessionId: p.activeSessionId };
}
