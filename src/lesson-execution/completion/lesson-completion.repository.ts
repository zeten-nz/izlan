import { Injectable } from '@nestjs/common';
import { ActivityAttemptStatus, ActivityType, LessonProgressStatus, Prisma, RoadmapStatus, SkillMeasurementSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface MasteryMeasurementRow {
  userId: string;
  lessonId: string;
  skillId: string;
  scoreBp: number;
  confidenceBp: number;
  evidenceCount: number; // distinct MASTERY_TEST activities attributed to this Skill (TD-113)
  observedAt: Date; // = LearnerLessonCompletion.completedAt (logical evidence time, TD-113)
}

/** Lesson completion + lesson-mastery persistence. Writes LearnerLessonCompletion + LearnerLessonProgress
 *  (terminal) + SkillMeasurement(LESSON_MASTERY). Never LearnerSkillState / roadmap items / reward / AI. */
@Injectable()
export class LessonCompletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** All activities of the pinned revision, ordered (eligibility, §8). */
  pinnedActivities(revisionId: string) {
    return this.prisma.activity.findMany({ where: { lessonRevisionId: revisionId }, orderBy: { position: 'asc' }, select: { id: true, type: true } });
  }

  /** Objective activities the learner has performed = have a SUBMITTED **normal-execution** attempt in the
   *  pinned revision (§6). reviewSessionId IS NULL isolates review attempts (RS-08, Phase 1.9B-2 §43). */
  async submittedActivityIds(userId: string, revisionId: string): Promise<Set<string>> {
    const rows = await this.prisma.activityAttempt.findMany({
      where: { userId, lessonRevisionId: revisionId, status: ActivityAttemptStatus.SUBMITTED, reviewSessionId: null },
      select: { activityId: true },
      distinct: ['activityId'],
    });
    return new Set(rows.map((r) => r.activityId));
  }

  findCompletion(userId: string, lessonId: string) {
    return this.prisma.learnerLessonCompletion.findFirst({ where: { userId, lessonId }, select: { id: true, lessonRevisionId: true, completedAt: true, masteryBestScore: true } });
  }

  createCompletion(data: { userId: string; lessonId: string; lessonRevisionId: string; completedAt: Date; startedAt: Date | null; masteryBestScore: number | null }) {
    return this.prisma.learnerLessonCompletion.create({
      data: { userId: data.userId, lessonId: data.lessonId, lessonRevisionId: data.lessonRevisionId, completionNo: 1, startedAt: data.startedAt, completedAt: data.completedAt, masteryBestScore: data.masteryBestScore },
      select: { id: true, completedAt: true },
    });
  }

  /** Terminal transition IN_PROGRESS → COMPLETED (conditional; concurrency-safe). completionPct untouched (§68 OPEN). */
  markProgressCompleted(userId: string, lessonId: string, completedAt: Date, masteryBestScore: number | null) {
    return this.prisma.learnerLessonProgress.updateMany({
      where: { userId, lessonId, status: LessonProgressStatus.IN_PROGRESS },
      data: { status: LessonProgressStatus.COMPLETED, completedAt, masteryBestScore },
    });
  }

  masteryTestActivityIds(revisionId: string) {
    return this.prisma.activity.findMany({ where: { lessonRevisionId: revisionId, type: ActivityType.MASTERY_TEST }, select: { id: true } });
  }

  /** Best (max) deterministic score per activity across the learner's SUBMITTED **normal-execution** attempts
   *  (§20). reviewSessionId IS NULL excludes review attempts from lesson-mastery-v1 (RS-09, Phase 1.9B-2 §44). */
  async bestScores(userId: string, activityIds: string[]): Promise<Map<string, number>> {
    if (activityIds.length === 0) return new Map();
    const rows = await this.prisma.activityAttempt.groupBy({
      by: ['activityId'],
      where: { userId, activityId: { in: activityIds }, status: ActivityAttemptStatus.SUBMITTED, deterministicScore: { not: null }, reviewSessionId: null },
      _max: { deterministicScore: true },
    });
    return new Map(rows.map((r) => [r.activityId, r._max.deterministicScore ?? 0]));
  }

  /** ActivitySkill attribution (§24). */
  async activitySkills(activityIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.activitySkill.findMany({ where: { activityId: { in: activityIds } }, select: { activityId: true, skillId: true } });
    const map = new Map<string, string[]>();
    for (const r of rows) (map.get(r.activityId) ?? map.set(r.activityId, []).get(r.activityId)!).push(r.skillId);
    return map;
  }

  /** LessonSkill fallback (§25). */
  async lessonSkillIds(lessonId: string): Promise<string[]> {
    const rows = await this.prisma.lessonSkill.findMany({ where: { lessonId }, select: { skillId: true } });
    return rows.map((r) => r.skillId);
  }

  /** The lesson's Subject (via hierarchy) for subject-scope validation (§66). */
  async lessonSubjectId(lessonId: string): Promise<string | null> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } },
    });
    return lesson?.topic.module.level.track.subjectId ?? null;
  }

  /** subjectId per skill (subject-scope check, §66). */
  async skillSubjects(skillIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, subjectId: true } });
    return new Map(rows.map((r) => [r.id, r.subjectId]));
  }

  /** Append-only, idempotent (ON CONFLICT DO NOTHING via the lesson idempotency partial-unique, SP-10). */
  createMasteryMeasurements(rows: MasteryMeasurementRow[], derivationVersion: string) {
    return this.prisma.skillMeasurement.createMany({
      data: rows.map((r) => ({ userId: r.userId, skillId: r.skillId, source: SkillMeasurementSource.LESSON_MASTERY, lessonId: r.lessonId, scoreBp: r.scoreBp, confidenceBp: r.confidenceBp, evidenceCount: r.evidenceCount, observedAt: r.observedAt, displayLevel: null, derivationVersion })),
      skipDuplicates: true,
    });
  }

  /** ACTIVE roadmaps whose items include this lesson — targets for the reconciliation hook (§40/41). */
  async activeRoadmapIdsContainingLesson(userId: string, lessonId: string): Promise<string[]> {
    const rows = await this.prisma.learnerRoadmap.findMany({
      where: { userId, status: RoadmapStatus.ACTIVE, items: { some: { lessonId } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Own, IN_PROGRESS-or-any progress with pinned revision + started time (for completion). */
  findProgress(userId: string, lessonId: string) {
    return this.prisma.learnerLessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
      select: { lessonId: true, lessonRevisionId: true, status: true, startedAt: true, completedActivities: true },
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
