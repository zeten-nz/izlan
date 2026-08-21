import { Injectable } from '@nestjs/common';
import { ActivityAttemptStatus, ActivityType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MissionEvidence } from './mission/daily-mission.policy';

const OBJECTIVE_TYPE_LIST = [ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST];

/** Daily-mission persistence. READS ActivityAttempt evidence + profile timezone; WRITES only append-only
 *  DailyMissionCompletion (+ its evidence). Never writes reward/skill/signal/plan/roadmap/session (§68-73). */
@Injectable()
export class DailyMissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  profileTimezone(userId: string): Promise<string | null> {
    return this.prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } }).then((p) => p?.timezone ?? null);
  }

  /** One own SUBMITTED objective attempt as mission evidence (automatic path); null if not own/found/objective. */
  async attemptEvidence(userId: string, attemptId: string): Promise<MissionEvidence | null> {
    const a = await this.prisma.activityAttempt.findFirst({
      where: { id: attemptId, userId, status: ActivityAttemptStatus.SUBMITTED, activity: { type: { in: OBJECTIVE_TYPE_LIST } } },
      select: { id: true, status: true, deterministicScore: true, submittedAt: true, reviewSessionId: true, activity: { select: { type: true } } },
    });
    if (!a || !a.submittedAt) return null;
    return { attemptId: a.id, activityType: a.activity.type, status: a.status, deterministicScoreBp: a.deterministicScore, submittedAt: a.submittedAt, reviewSessionId: a.reviewSessionId };
  }

  /** All own SUBMITTED objective attempts since `sinceUtc` (reconcile day-window bound; exact localDate filtered in the service). */
  async eligibleAttempts(userId: string, sinceUtc: Date): Promise<MissionEvidence[]> {
    const rows = await this.prisma.activityAttempt.findMany({
      where: { userId, status: ActivityAttemptStatus.SUBMITTED, submittedAt: { gte: sinceUtc }, activity: { type: { in: OBJECTIVE_TYPE_LIST } } },
      select: { id: true, status: true, deterministicScore: true, submittedAt: true, reviewSessionId: true, activity: { select: { type: true } } },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.filter((a) => a.submittedAt !== null).map((a) => ({ attemptId: a.id, activityType: a.activity.type, status: a.status, deterministicScoreBp: a.deterministicScore, submittedAt: a.submittedAt as Date, reviewSessionId: a.reviewSessionId }));
  }

  /** Persisted completions for a learner-local day (GET authority + XP bridge, §25). */
  completionsForDay(userId: string, localDate: Date) {
    return this.prisma.dailyMissionCompletion.findMany({
      where: { userId, localDate },
      select: { id: true, missionCode: true, policyVersion: true, completedAt: true },
    });
  }

  /**
   * Append-only completion + evidence, idempotent. The one-completion-per-(user,mission,localDate) partial unique
   * (DM-DB-01) is the concurrency authority — a duplicate returns false (the first evidence wins, §29/42).
   */
  async createCompletion(data: {
    userId: string;
    missionCode: string;
    policyVersion: string;
    localDate: Date;
    timezoneSnapshot: string;
    completedAt: Date;
    activityAttemptId: string;
  }): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const c = await tx.dailyMissionCompletion.create({
          data: { userId: data.userId, missionCode: data.missionCode, policyVersion: data.policyVersion, localDate: data.localDate, timezoneSnapshot: data.timezoneSnapshot, completedAt: data.completedAt },
          select: { id: true },
        });
        await tx.dailyMissionCompletionEvidence.create({ data: { completionId: c.id, activityAttemptId: data.activityAttemptId } });
      });
      return true;
    } catch (e) {
      if (this.isUniqueViolation(e)) return false; // already completed this mission today
      throw e;
    }
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
