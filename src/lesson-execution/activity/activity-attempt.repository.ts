import { Injectable } from '@nestjs/common';
import { ActivityAttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface CreateAttemptData {
  userId: string;
  activityId: string;
  lessonRevisionId: string;
  attemptNo: number;
  answer: Prisma.InputJsonValue;
  isCorrect: boolean;
  deterministicScore: number;
  clientRequestId: string;
  submittedAt: Date;
}

const ATTEMPT_VIEW = {
  id: true,
  activityId: true,
  attemptNo: true,
  answer: true,
  isCorrect: true,
  deterministicScore: true,
  status: true,
  submittedAt: true,
} satisfies Prisma.ActivityAttemptSelect;

/** ActivityAttempt evidence (append-only) + LearnerLessonProgress resume-cache update. No completion/roadmap/skill. */
@Injectable()
export class ActivityAttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Load an Activity + its revision membership (to distinguish not-found vs not-in-pinned-revision, §13/43). */
  findActivity(activityId: string) {
    return this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, type: true, position: true, payload: true, lessonRevisionId: true },
    });
  }

  /** Existing attempt for this durable request id (idempotency authority ux_attempt_client_request, §16/17). */
  findByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.activityAttempt.findFirst({ where: { userId, clientRequestId }, select: ATTEMPT_VIEW });
  }

  async maxAttemptNo(userId: string, activityId: string): Promise<number> {
    const agg = await this.prisma.activityAttempt.aggregate({ where: { userId, activityId }, _max: { attemptNo: true } });
    return agg._max.attemptNo ?? 0;
  }

  /** Append-only create. attemptNo + clientRequestId uniques are the concurrency authority (caller retries/replays). */
  create(data: CreateAttemptData) {
    return this.prisma.activityAttempt.create({
      data: {
        userId: data.userId,
        activityId: data.activityId,
        lessonRevisionId: data.lessonRevisionId,
        attemptNo: data.attemptNo,
        status: ActivityAttemptStatus.SUBMITTED,
        answer: data.answer,
        isCorrect: data.isCorrect,
        deterministicScore: data.deterministicScore,
        clientRequestId: data.clientRequestId,
        submittedAt: data.submittedAt,
        // roadmapItemId / learningSessionId left null — progress retains no unambiguous context (§26/27).
      },
      select: ATTEMPT_VIEW,
    });
  }

  /**
   * Record the activity as a performed step in the resume cache (§28/30). Idempotent (set-union, dedupe);
   * completedActivities is a resume CACHE, not completion authority (ActivityAttempt rows are authority).
   */
  async recordActivityStep(userId: string, lessonId: string, activityId: string): Promise<void> {
    const progress = await this.prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } }, select: { completedActivities: true } });
    const current = Array.isArray(progress?.completedActivities) ? (progress!.completedActivities as string[]) : [];
    const union = current.includes(activityId) ? current : [...current, activityId];
    await this.prisma.learnerLessonProgress.update({
      where: { userId_lessonId: { userId, lessonId } },
      data: { completedActivities: union, lastActivityId: activityId },
    });
  }
}
