import { Injectable } from '@nestjs/common';
import { DailyPlanStatus, LessonProgressStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { currentVisibleLessonWhere, resumableLessonWhere } from '../content/visibility/learner-content-visibility';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const PROGRESS_VIEW = {
  id: true,
  lessonId: true,
  lessonRevisionId: true,
  status: true,
  startedAt: true,
  lastActivityId: true,
} satisfies Prisma.LearnerLessonProgressSelect;

/**
 * Lesson-execution persistence. Writes ONLY LearnerLessonProgress (revision-pinned resume state).
 * No LearnerLessonCompletion, no ActivityAttempt (Activity contract deferred), no roadmap/skill writes.
 */
@Injectable()
export class LessonExecutionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A DailyPlanItem that belongs to the learner's TODAY CURRENT plan (§4 — old plans cannot start). */
  findTodayPlanItem(userId: string, localDate: Date, dailyPlanItemId: string) {
    return this.prisma.dailyPlanItem.findFirst({
      where: { id: dailyPlanItemId, dailyPlan: { userId, localDate, status: DailyPlanStatus.CURRENT } },
      select: { id: true, lessonId: true, itemType: true },
    });
  }

  /** Current resume state for a logical Lesson (unique(userId, lessonId) is the idempotency authority). */
  findProgress(userId: string, lessonId: string) {
    return this.prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } }, select: PROGRESS_VIEW });
  }

  /**
   * The lesson's CURRENT published revision id — only if it is currently learner-visible via the canonical visibility
   * authority (full Subject→Topic hierarchy PUBLISHED + current-pointer coherence, Phase 2.2B §34). Used for NEW starts.
   */
  async publishedRevisionId(lessonId: string): Promise<string | null> {
    const lesson = await this.prisma.lesson.findFirst({ where: currentVisibleLessonWhere(lessonId), select: { publishedRevisionId: true } });
    return lesson?.publishedRevisionId ?? null;
  }

  /** Is a pinned execution still resumable — Lesson + full hierarchy PUBLISHED (denies resume after takedown, §36B/38)? */
  async isLessonResumable(lessonId: string): Promise<boolean> {
    const lesson = await this.prisma.lesson.findFirst({ where: resumableLessonWhere(lessonId), select: { id: true } });
    return lesson !== null;
  }

  /** First start pins the resolved published revision (§8). Caller catches P2002 (concurrent start, §11). */
  createProgress(userId: string, lessonId: string, lessonRevisionId: string) {
    return this.prisma.learnerLessonProgress.create({
      data: { userId, lessonId, lessonRevisionId, status: LessonProgressStatus.IN_PROGRESS },
      select: PROGRESS_VIEW,
    });
  }

  /**
   * Learner-safe content of the PINNED revision (§14/15). Exposes only title/description/duration +
   * activity identity/type/position. NEVER the Activity.payload body (its answer-key layout is an
   * unaccepted contract, §18/28) nor authoring/lifecycle fields.
   */
  revisionContent(revisionId: string) {
    return this.prisma.lessonRevision.findUnique({
      where: { id: revisionId },
      select: {
        title: true,
        description: true,
        estimatedDurationMin: true,
        // payload is included only so the service can build the learner projection (objective types) and
        // STRIP the answer key — it is never returned raw (§10/34).
        activities: {
          orderBy: { position: 'asc' },
          select: {
            id: true, type: true, position: true, payload: true,
            // Attached learner media — SAFE fields only; altText is per-attachment (ActivityMedia), storageKey is NEVER selected (§14).
            media: { orderBy: { position: 'asc' }, select: { altText: true, media: { select: { id: true, mimeType: true } } } },
          },
        },
      },
    });
  }
}
