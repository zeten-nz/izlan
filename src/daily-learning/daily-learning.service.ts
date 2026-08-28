import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { DailyLearningNotFoundError, DailyLearningUnavailableError } from '../common/errors';
import { formatDateOnly, localDateInTimezone, toDateOnly } from '../daily-plan/local-date.util';
import { V2RoadmapService, type V2RoadmapPointView } from '../learning-core/v2-roadmap.service';
import { DailyLearningRepository, isUniqueViolation } from './daily-learning.repository';
import { attentionItems, DAILY_LEARNING_ENGINE_VERSION, DAILY_LEARNING_POLICY_VERSION, deriveTodayAction, selectMainPoint, type DailyActionResult } from './daily-learning.policy';

export interface DailyGoalView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  estimatedEffortMin: number | null;
  canDo: string[];
  acquired: boolean;
  availability: string;
  activeSessionId: string | null;
}
export interface DailyAttentionView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  attention: string; // REVIEW_DUE | REPAIR_REQUIRED
  attentionReason: string | null;
  attentionSkill: { id: string; name: string } | null;
}
export interface DailyView {
  localDate: string; // YYYY-MM-DD in the learner's timezone
  timezone: string;
  generationNo: number;
  status: string;
  policyVersion: string;
  engineVersion: string;
  subject: { id: string; title: string };
  mainGoal: DailyGoalView | null; // the ONE new point chosen for the day (null when nothing new is available)
  action: DailyActionResult; // the single next action (repair > review > learn main > done), one-new-point-capped
  attention: DailyAttentionView[]; // acquired points currently needing repair/review
  progress: { mainGoalDone: boolean; roadmapAcquired: number; roadmapTotal: number };
  done: boolean; // fully caught up for today
}

/**
 * V2 Daily Learning orchestration. It resolves the learner-local day, snapshots the ONE new-learning point for
 * that day (reproducible + one-new-point-per-day), and projects the single most useful next action LIVE over the
 * current V2 roadmap — routing into the existing Teaching/Review flows. It writes no evidence/acquisition/reward
 * and never rewrites a past day's plan (idempotent per local day via the one-CURRENT partial unique).
 */
@Injectable()
export class DailyLearningService {
  constructor(
    private readonly repo: DailyLearningRepository,
    private readonly roadmap: V2RoadmapService,
    private readonly clock: Clock,
  ) {}

  async getMyToday(userId: string): Promise<DailyView> {
    return this.getToday(userId, await this.requirePrimarySubject(userId));
  }
  async generateMyToday(userId: string): Promise<DailyView> {
    return this.generateOrGetToday(userId, await this.requirePrimarySubject(userId));
  }

  async getToday(userId: string, subjectId: string): Promise<DailyView> {
    const { localDate } = await this.resolveLocalDate(userId);
    const plan = await this.repo.findCurrentPlan(userId, subjectId, localDate);
    if (!plan) throw new DailyLearningNotFoundError('no daily plan for today');
    return this.project(plan.id, plan.userId, plan.subjectId, plan);
  }

  async generateOrGetToday(userId: string, subjectId: string): Promise<DailyView> {
    const { tz, localDate } = await this.resolveLocalDate(userId);
    const existing = await this.repo.findCurrentPlan(userId, subjectId, localDate);
    if (existing) return this.project(existing.id, userId, subjectId, existing); // same-day idempotency — no re-plan

    // Decide the day's main point + action from the CURRENT roadmap (attention/availability already derived).
    const view = await this.roadmap.getRoadmap(userId, subjectId);
    if (!view.generation || view.points.length === 0) throw new DailyLearningUnavailableError('no roadmap content for subject');
    const main = selectMainPoint(view.points);
    const action = deriveTodayAction(view.points, main?.roadmapPointId ?? null);
    const decision: Prisma.InputJsonValue = {
      schemaVersion: 'daily-learning-decision/v1',
      action: action.type,
      reason: action.reason,
      mainPointId: main?.roadmapPointId ?? null,
      mainPointKey: main?.pointKey ?? null,
      mainPointTitle: main?.title ?? null,
      estimatedEffortMin: main?.estimatedEffortMin ?? null,
      policyVersion: DAILY_LEARNING_POLICY_VERSION,
    };
    const generationNo = await this.repo.nextGenerationNo(userId, subjectId, localDate);
    try {
      const plan = await this.repo.createPlan({ userId, subjectId, localDate, timezoneSnapshot: tz, generationNo, policyVersion: DAILY_LEARNING_POLICY_VERSION, engineVersion: DAILY_LEARNING_ENGINE_VERSION, mainRoadmapPointId: main?.roadmapPointId ?? null, decision });
      return this.project(plan.id, userId, subjectId, plan);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await this.repo.findCurrentPlan(userId, subjectId, localDate); // concurrent generate won the one-CURRENT partial unique
        if (winner) return this.project(winner.id, userId, subjectId, winner);
      }
      throw e;
    }
  }

  private async project(_planId: string, userId: string, subjectId: string, plan: { localDate: Date; timezoneSnapshot: string; generationNo: number; status: string; policyVersion: string; engineVersion: string; mainRoadmapPointId: string | null }): Promise<DailyView> {
    const view = await this.roadmap.getRoadmap(userId, subjectId);
    const points = view.points;
    const main = plan.mainRoadmapPointId ? points.find((p) => p.roadmapPointId === plan.mainRoadmapPointId) ?? null : null;
    const action = deriveTodayAction(points, plan.mainRoadmapPointId);
    const acquiredCount = points.filter((p) => p.learned || p.validated).length;
    const subjectTitle = (await this.repo.subjectTitle(subjectId)) ?? '';
    const mainAcquired = main ? main.learned || main.validated : plan.mainRoadmapPointId === null;

    return {
      localDate: formatDateOnly(plan.localDate),
      timezone: plan.timezoneSnapshot,
      generationNo: plan.generationNo,
      status: plan.status,
      policyVersion: plan.policyVersion,
      engineVersion: plan.engineVersion,
      subject: { id: subjectId, title: subjectTitle },
      mainGoal: main ? this.goalView(main, mainAcquired) : null,
      action,
      attention: attentionItems(points).map((p) => ({ roadmapPointId: p.roadmapPointId, pointKey: p.pointKey, title: p.title, attention: p.attention, attentionReason: p.attentionReason, attentionSkill: p.attentionSkill })),
      progress: { mainGoalDone: mainAcquired, roadmapAcquired: acquiredCount, roadmapTotal: points.length },
      done: action.type === 'DONE',
    };
  }

  private goalView(p: V2RoadmapPointView, acquired: boolean): DailyGoalView {
    return {
      roadmapPointId: p.roadmapPointId,
      pointKey: p.pointKey,
      title: p.title,
      estimatedEffortMin: p.estimatedEffortMin,
      canDo: (p.learningOutcome as { canDo?: string[] } | null)?.canDo ?? [],
      acquired,
      availability: p.availability,
      activeSessionId: p.activeSessionId,
    };
  }

  private async requirePrimarySubject(userId: string): Promise<string> {
    const subjectId = await this.repo.primarySubjectId(userId);
    if (!subjectId) throw new DailyLearningUnavailableError('no learning subject — complete onboarding');
    return subjectId;
  }

  private async resolveLocalDate(userId: string): Promise<{ tz: string; localDate: Date }> {
    const tz = await this.repo.timezone(userId);
    if (!tz) throw new DailyLearningUnavailableError('no profile timezone');
    return { tz, localDate: toDateOnly(localDateInTimezone(this.clock.now(), tz)) };
  }
}
