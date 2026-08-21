import { Injectable } from '@nestjs/common';
import {
  AssessmentAttemptPurpose,
  AssessmentAttemptStatus,
  AssessmentResponseStatus,
  ContainerStatus,
  LessonStatus,
  Prisma,
  RoadmapItemSource,
  RoadmapItemType,
  RoadmapStatus,
  SkillMeasurementSource,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** Prisma unique-constraint violation (ux_active_roadmap race). */
export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface RoadmapItemPlan {
  lessonId: string;
  skillId: string;
  position: number;
}

const ROADMAP_VIEW = {
  id: true,
  subjectId: true,
  trackId: true,
  status: true,
  sourceAssessmentAttemptId: true,
  generatedAt: true,
  items: {
    orderBy: { position: 'asc' },
    select: { id: true, itemType: true, lessonId: true, checkpointId: true, skillId: true, position: true, status: true },
  },
} satisfies Prisma.LearnerRoadmapSelect;

/**
 * Roadmap persistence + read-only access to assessment/content/completion tables (one-way; no Nest
 * import of assessment/skill-profile modules). Reads only human-approved, learner-visible content.
 */
@Injectable()
export class RoadmapRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /** Own, COMPLETED, INITIAL_DIAGNOSTIC attempt (null → 404-safe). */
  findSourceAttempt(userId: string, attemptId: string) {
    return this.prisma.assessmentAttempt.findFirst({
      where: { id: attemptId, userId, status: AssessmentAttemptStatus.COMPLETED, purpose: AssessmentAttemptPurpose.INITIAL_DIAGNOSTIC },
      select: { id: true, userId: true, subjectId: true, trackId: true },
    });
  }

  /** Exact diagnostic SkillMeasurement snapshot (§7) — the roadmap priority authority, not current state. */
  diagnosticMeasurements(attemptId: string, derivationVersion: string) {
    return this.prisma.skillMeasurement.findMany({
      where: { attemptId, source: SkillMeasurementSource.DIAGNOSTIC, derivationVersion },
      select: { skillId: true, scoreBp: true, confidenceBp: true },
    });
  }

  /** Reproducible per-skill evidence count = SUBMITTED objective responses for this attempt. */
  async evidenceCountsBySkill(attemptId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.assessmentResponse.findMany({
      where: { attemptId, status: AssessmentResponseStatus.SUBMITTED },
      select: { item: { select: { skillId: true } } },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.item.skillId, (counts.get(r.item.skillId) ?? 0) + 1);
    return counts;
  }

  /** Explicit content→Skill mapping (LessonSkill) for the given skills — the ONLY mapping authority (§11). */
  mappedLessons(skillIds: string[]) {
    return this.prisma.lessonSkill.findMany({ where: { skillId: { in: skillIds } }, select: { skillId: true, lessonId: true } });
  }

  /** All lessons the learner has an authoritative completion for (completion truth, §4). One query. */
  async completedLessonIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.learnerLessonCompletion.findMany({ where: { userId }, select: { lessonId: true } });
    return new Set(rows.map((r) => r.lessonId));
  }

  /** All lessons the learner has begun (progress exists, §5). One query. */
  async inProgressLessonIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.learnerLessonProgress.findMany({ where: { userId }, select: { lessonId: true } });
    return new Set(rows.map((r) => r.lessonId));
  }

  /** LessonPrerequisite edges for a batch of lessons (caller iterates for transitive closure). */
  prerequisiteEdges(lessonIds: string[]) {
    return this.prisma.lessonPrerequisite.findMany({ where: { lessonId: { in: lessonIds } }, select: { lessonId: true, prerequisiteLessonId: true } });
  }

  /**
   * Eligibility + ordering meta for arbitrary lessons. Learner-visible = Lesson PUBLISHED + has a
   * PUBLISHED revision + the whole Topic→Module→Level chain PUBLISHED (§9). No authoring metadata.
   */
  async lessonMeta(lessonIds: string[]): Promise<Map<string, { eligible: boolean; topicSortOrder: number; lessonSortOrder: number; title: string | null }>> {
    const rows = await this.prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: {
        id: true,
        status: true,
        publishedRevisionId: true,
        sortOrder: true,
        topic: { select: { status: true, sortOrder: true, module: { select: { status: true, level: { select: { status: true } } } } } },
        publishedRevision: { select: { title: true } }, // current learner-facing revision (§25/26); null when unpublished
      },
    });
    const out = new Map<string, { eligible: boolean; topicSortOrder: number; lessonSortOrder: number; title: string | null }>();
    for (const l of rows) {
      const eligible =
        l.status === LessonStatus.PUBLISHED &&
        l.publishedRevisionId !== null &&
        l.topic.status === ContainerStatus.PUBLISHED &&
        l.topic.module.status === ContainerStatus.PUBLISHED &&
        l.topic.module.level.status === ContainerStatus.PUBLISHED;
      // Title only from the CURRENT published revision — never a draft/archived body (§7 hidden-content safety).
      out.set(l.id, { eligible, topicSortOrder: l.topic.sortOrder, lessonSortOrder: l.sortOrder, title: eligible ? l.publishedRevision?.title ?? null : null });
    }
    return out;
  }

  findActiveRoadmap(userId: string, subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerRoadmap.findFirst({ where: { userId, subjectId, status: RoadmapStatus.ACTIVE }, select: ROADMAP_VIEW });
  }

  findOwnRoadmap(userId: string, roadmapId: string) {
    return this.prisma.learnerRoadmap.findFirst({ where: { id: roadmapId, userId }, select: ROADMAP_VIEW });
  }

  /**
   * Idempotent, concurrency-safe ACTIVE → COMPLETED transition (§15/35). Conditional (status=ACTIVE)
   * so a concurrent reconcile / an already-COMPLETED roadmap is a no-op. LearnerRoadmap has no
   * completedAt field, so only status changes (updatedAt auto-updates). Never COMPLETED → ACTIVE.
   */
  async transitionToCompleted(roadmapId: string, userId: string): Promise<number> {
    const r = await this.prisma.learnerRoadmap.updateMany({
      where: { id: roadmapId, userId, status: RoadmapStatus.ACTIVE },
      data: { status: RoadmapStatus.COMPLETED },
    });
    return r.count;
  }

  /** Atomic header + items (§55). ux_active_roadmap is the concurrency authority (caller catches P2002). */
  async createRoadmap(header: { userId: string; subjectId: string; trackId: string; sourceAssessmentAttemptId: string }, items: RoadmapItemPlan[]) {
    return this.prisma.$transaction(async (tx) => {
      const roadmap = await tx.learnerRoadmap.create({
        data: {
          userId: header.userId,
          subjectId: header.subjectId,
          trackId: header.trackId,
          status: RoadmapStatus.ACTIVE,
          sourceAssessmentAttemptId: header.sourceAssessmentAttemptId,
        },
        select: { id: true },
      });
      await tx.roadmapItem.createMany({
        data: items.map((i) => ({
          roadmapId: roadmap.id,
          itemType: RoadmapItemType.LESSON,
          lessonId: i.lessonId,
          skillId: i.skillId,
          position: i.position,
          source: RoadmapItemSource.INITIAL_GENERATION,
        })),
      });
      return roadmap.id;
    });
  }
}
