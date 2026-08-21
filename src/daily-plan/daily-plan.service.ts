import { Injectable } from '@nestjs/common';
import { DailyPlanItemType, DailyPlanSection } from '@prisma/client';
import { Clock } from '../common/clock';
import { DailyPlanConfigurationInvalidError, DailyPlanNoExecutableContentError, DailyPlanNotFoundError, RoadmapNotFoundError } from '../common/errors';
import { ProfileRepository } from '../profile/profile.repository';
import { RoadmapReadService } from '../roadmap/read/roadmap-read.service';
import { ReviewService } from '../review/review.service';
import { DailyPlanReadService, DailyPlanView } from './daily-plan-read.service';
import { DailyPlanRepository, PlanItemRow, isUniqueViolation } from './daily-plan.repository';
import { localDateInTimezone, toDateOnly } from './local-date.util';
import { selectPlanItems } from './plan-selection';
import { ReviewExtraCandidate, selectReviewExtra } from './daily-review-extra-selection';

/**
 * Daily Plan Foundation (Phase 1.7A, daily-plan-roadmap-v1). A profile-local-day snapshot of the
 * learner's ACTIVE roadmap focused on exactly one Topic. Read-only against roadmap/progress/completion/
 * skill state; no Lesson execution, no rewards/missions, no AI (§60-66).
 */
@Injectable()
export class DailyPlanService {
  constructor(
    private readonly repo: DailyPlanRepository,
    private readonly roadmapRead: RoadmapReadService,
    private readonly profiles: ProfileRepository,
    private readonly read: DailyPlanReadService,
    private readonly clock: Clock,
    private readonly reviewCandidates: ReviewService,
  ) {}

  /** Read today's CURRENT plan. Never generates, never mutates (§50). */
  async getToday(userId: string): Promise<DailyPlanView> {
    const { localDateObj } = await this.resolveLocalDate(userId);
    const plan = await this.repo.findCurrentPlan(userId, localDateObj);
    if (!plan) throw new DailyPlanNotFoundError('no daily plan for today');
    return this.read.project(userId, plan);
  }

  /** Generate-or-return today's CURRENT plan. Idempotent per local day; one Topic per day (§10/11). */
  async generateOrGetToday(userId: string): Promise<DailyPlanView> {
    const { tz, localDateObj } = await this.resolveLocalDate(userId);

    const existing = await this.repo.findCurrentPlan(userId, localDateObj);
    if (existing) return this.read.project(userId, existing); // same-day → same plan, no second Topic (§10/11/39)

    // Roadmap source: the learner's ACTIVE roadmap (earliest if multiple — primary-subject is OPEN).
    const actives = await this.repo.activeRoadmaps(userId);
    if (actives.length === 0) throw new RoadmapNotFoundError('no active roadmap');
    const roadmap = await this.roadmapRead.getActive(userId, actives[0].subjectId);

    // Phase 1.6B nextItem is the entry authority — DailyPlan does not re-derive gap/prereq/completion (§4/5).
    if (!roadmap.nextItemId) throw new DailyPlanNoExecutableContentError('no executable content'); // §21/22/23/24

    const lessonIds = roadmap.items.map((i) => i.lesson.id).filter((x): x is string => x !== null);
    const topicRows = await this.repo.lessonTopics(lessonIds);
    const topicOf = new Map<string, string>();
    for (const [lid, t] of topicRows) topicOf.set(lid, t.topicId);

    const selection = selectPlanItems(roadmap.items, roadmap.nextItemId, topicOf);
    if (!selection || selection.planItems.length === 0) throw new DailyPlanNoExecutableContentError('no executable content');
    // §20 one-Topic invariant (fail safe on corrupt relations).
    for (const pi of selection.planItems) if (topicOf.get(pi.lessonId) !== selection.topicId) throw new DailyPlanConfigurationInvalidError('mixed topic');

    // Core plan items (roadmap-backed LESSON).
    const coreItems: PlanItemRow[] = selection.planItems.map((pi) => ({ section: pi.section as DailyPlanSection, itemType: DailyPlanItemType.LESSON, roadmapItemId: pi.roadmapItemId, lessonId: pi.lessonId, skillId: pi.skillId, position: pi.position }));
    // Phase 2.0A: at most ONE optional same-Topic review EXTRA (daily-review-extra-v1). ReviewCandidate is authority.
    const extra = await this.pickReviewExtra(userId, actives[0].subjectId, selection.topicId, new Set(coreItems.map((i) => i.lessonId)));
    const items = extra ? [...coreItems, { section: DailyPlanSection.EXTRA, itemType: DailyPlanItemType.REVIEW, roadmapItemId: null, lessonId: extra.lessonId, skillId: extra.skillId, position: coreItems.length + 1 }] : coreItems;

    const generationNo = await this.repo.nextGenerationNo(userId, localDateObj);
    let planId: string;
    try {
      planId = await this.repo.createPlan({ userId, localDate: localDateObj, timezoneSnapshot: tz, generationNo }, items);
    } catch (e) {
      // ux_current_daily_plan race (§35): a concurrent request won.
      if (isUniqueViolation(e)) {
        const winner = await this.repo.findCurrentPlan(userId, localDateObj);
        if (winner) return this.read.project(userId, winner);
      }
      throw e;
    }
    const created = await this.repo.findPlanById(planId);
    return this.read.project(userId, created!);
  }

  /**
   * Pick at most one optional review EXTRA for a NEW plan (§10/13). Reuses the Phase 1.9A ReviewCandidate read
   * model as the eligibility authority (read-only; no signal/candidate mutation, §34), flattens its Skill-ordered
   * groups, and runs the pure deterministic selector (same-Topic + core dedup + priority + one-item cap).
   */
  private async pickReviewExtra(userId: string, subjectId: string, coreTopicId: string, coreLessonIds: Set<string>): Promise<{ lessonId: string; skillId: string } | null> {
    const { groups } = await this.reviewCandidates.getCandidates(userId, subjectId); // O(few) batched (§41)
    const candidates: ReviewExtraCandidate[] = [];
    groups.forEach((g, groupIndex) =>
      g.candidates.forEach((c, candidateIndex) =>
        candidates.push({ skillId: g.skill.id, groupIndex, candidateIndex, signalTypes: g.signalTypes, lessonId: c.lesson.id, lessonTopicId: c.lesson.topicId, exposure: c.exposure, directTrigger: c.directTrigger }),
      ),
    );
    return selectReviewExtra(coreTopicId, coreLessonIds, candidates);
  }

  private async resolveLocalDate(userId: string): Promise<{ tz: string; localDateObj: Date }> {
    const profile = await this.profiles.getProfile(userId);
    if (!profile?.timezone) throw new DailyPlanConfigurationInvalidError('no profile timezone'); // §21
    const localDate = localDateInTimezone(this.clock.now(), profile.timezone); // profile-local, never server UTC (§6)
    return { tz: profile.timezone, localDateObj: toDateOnly(localDate) };
  }
}
