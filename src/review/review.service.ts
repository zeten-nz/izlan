import { Injectable } from '@nestjs/common';
import { ResourceNotFoundError, ReviewCandidateNotAvailableError } from '../common/errors';
import { ReviewRepository } from './review.repository';
import { buildReviewCandidates } from './candidate/review-candidate.engine';
import { ReviewCandidateResult } from './candidate/review-candidate.types';

/**
 * Review Candidates (Phase 1.9A). A deterministic READ MODEL: ACTIVE REPEATED_MISTAKE / WEAK_SKILL /
 * REVIEW_DUE signals → encountered + currently-visible, explicitly Skill-mapped Lessons the learner has
 * already seen. Writes NOTHING; never resolves signals; not an execution authority (TD-122/123/124).
 */
@Injectable()
export class ReviewService {
  constructor(private readonly repo: ReviewRepository) {}

  async getCandidates(userId: string, subjectId: string): Promise<{ subjectId: string } & ReviewCandidateResult> {
    const subject = await this.repo.getSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found'); // §73 existing safe-resource semantics
    const facts = await this.repo.loadFacts(userId, subjectId);
    const { groups, uncoveredSkillIds } = buildReviewCandidates(facts); // pure, deterministic
    return { subjectId, groups, uncoveredSkillIds };
  }

  /**
   * Internal read-only candidate revalidation for Review Session START (Phase 1.9B-2 §16/17). Re-derives the
   * 1.9A policy from scratch (never trusts a prior GET). Throws REVIEW_CANDIDATE_NOT_AVAILABLE if the Lesson is
   * not a current candidate for the Skill; returns the canonical ACTIVE signalTypes for the provenance snapshot.
   */
  async assertCandidateAvailable(userId: string, subjectId: string, skillId: string, lessonId: string): Promise<{ signalTypes: string[] }> {
    const facts = await this.repo.loadFacts(userId, subjectId);
    const { groups } = buildReviewCandidates(facts);
    const group = groups.find((g) => g.skill.id === skillId);
    if (!group || !group.candidates.some((c) => c.lesson.id === lessonId)) throw new ReviewCandidateNotAvailableError('not a current review candidate');
    return { signalTypes: group.signalTypes };
  }
}
