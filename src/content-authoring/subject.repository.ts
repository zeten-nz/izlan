import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from './optimistic-concurrency';

/**
 * Subject + SubjectAssignment persistence (Phase 2.2A-1). Subjects are top-level (no parent scope); assignments
 * are the scope authority for child content. unique(userId, subjectId) is the assignment authority (§8).
 */
@Injectable()
export class SubjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  // ── Subject ──
  createSubject(tx: Prisma.TransactionClient, data: { slug: string; title: string; description?: string | null; sortOrder: number; createdBy: string }) {
    return tx.subject.create({ data, select: SUBJECT_SELECT });
  }
  findSubject(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subject.findUnique({ where: { id }, select: SUBJECT_SELECT });
  }
  /**
   * Subjects the actor may author in (content.author scope) — those they hold an assignment for. ARCHIVED subjects are
   * hidden from the active list (retired content stays out of the authoring surface; history remains resolvable by id).
   */
  listAssignedSubjects(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subject.findMany({
      where: { assignments: { some: { userId } }, status: { not: ContainerStatus.ARCHIVED } },
      select: SUBJECT_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }
  updateSubjectConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.SubjectUpdateManyMutationInput) {
    // Strictly advance the OCC token by ≥1ms in the SAME write (TIMESTAMP(3) precision).
    return tx.subject.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  /** Subject DRAFT → PUBLISHED (Phase 2.2B); strictly advances updatedAt. */
  publishSubjectConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date) {
    return tx.subject.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { status: ContainerStatus.PUBLISHED, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── Safe deletion lifecycle ──────────────────────────────────────────────

  /**
   * TRUE if any LEARNER-FACING history is tied to this Subject — the signal that a Subject must NEVER be physically
   * destroyed. Checks the direct learner-history FKs plus the denormalized assessment-attempt column and the
   * point-acquisition path (via level→track). Any learner engagement leaves at least one of these rows.
   */
  async hasLearnerHistory(subjectId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = this.db(tx);
    const first = await Promise.all([
      db.learnerLearningIntent.findFirst({ where: { subjectId }, select: { id: true } }),
      db.learnerRoadmap.findFirst({ where: { subjectId }, select: { id: true } }),
      db.learnerSignal.findFirst({ where: { subjectId }, select: { id: true } }),
      db.placementDecision.findFirst({ where: { subjectId }, select: { id: true } }),
      db.learnerRoadmapGeneration.findFirst({ where: { subjectId }, select: { id: true } }),
      db.dailyLearningPlan.findFirst({ where: { subjectId }, select: { id: true } }),
      db.assessmentAttempt.findFirst({ where: { subjectId }, select: { id: true } }),
      db.pointAcquisitionEvent.findFirst({ where: { point: { level: { track: { subjectId } } } }, select: { id: true } }),
      db.teachingSession.findFirst({ where: { point: { level: { track: { subjectId } } } }, select: { id: true } }),
    ]);
    return first.some((r) => r !== null);
  }

  /** TRUE if the Subject itself or any descendant Track/Lesson/RoadmapPoint is PUBLISHED (learner-facing content exists). */
  async hasPublishedContent(subjectId: string, subjectStatus: ContainerStatus, tx?: Prisma.TransactionClient): Promise<boolean> {
    if (subjectStatus === ContainerStatus.PUBLISHED) return true;
    const db = this.db(tx);
    const [track, lesson, point] = await Promise.all([
      db.track.findFirst({ where: { subjectId, status: ContainerStatus.PUBLISHED }, select: { id: true } }),
      db.lesson.findFirst({ where: { topic: { module: { level: { track: { subjectId } } } }, status: 'PUBLISHED' }, select: { id: true } }),
      db.roadmapPoint.findFirst({ where: { level: { track: { subjectId } }, status: ContainerStatus.PUBLISHED }, select: { id: true } }),
    ]);
    return track !== null || lesson !== null || point !== null;
  }

  /** Retire a Subject: status → ARCHIVED (idempotent). Historical rows and their RESTRICT FKs are left intact. */
  archiveSubject(tx: Prisma.TransactionClient, id: string) {
    return tx.subject.update({ where: { id }, data: { status: ContainerStatus.ARCHIVED }, select: SUBJECT_SELECT });
  }

  /**
   * Physically delete the AUTHORED content owned by a disposable Subject, bottom-up, then the Subject row. Caller MUST
   * have already established there is NO learner history and the Subject is not published. Only semantically-owned
   * authoring rows are removed (hierarchy, skills, expectations, domains, assignments, draft assessment defs). If any
   * un-handled RESTRICT child remains (e.g. a V2 roadmap-point graph), the final delete raises P2003 and the WHOLE
   * transaction rolls back — the caller treats that as "not safely deletable" and archives instead. Never cascades
   * through learner history (those FKs are RESTRICT and would raise here rather than delete a fact).
   */
  async hardDeleteOwnedContent(tx: Prisma.TransactionClient, subjectId: string): Promise<void> {
    const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id);
    const trackIds = await ids(tx.track.findMany({ where: { subjectId }, select: { id: true } }));
    const levelIds = await ids(tx.level.findMany({ where: { trackId: { in: trackIds } }, select: { id: true } }));
    const moduleIds = await ids(tx.module.findMany({ where: { levelId: { in: levelIds } }, select: { id: true } }));
    const topicIds = await ids(tx.topic.findMany({ where: { moduleId: { in: moduleIds } }, select: { id: true } }));
    const lessonIds = await ids(tx.lesson.findMany({ where: { topicId: { in: topicIds } }, select: { id: true } }));
    const revisionIds = await ids(tx.lessonRevision.findMany({ where: { lessonId: { in: lessonIds } }, select: { id: true } }));
    const activityIds = await ids(tx.activity.findMany({ where: { lessonRevisionId: { in: revisionIds } }, select: { id: true } }));
    const skillIds = await ids(tx.skill.findMany({ where: { subjectId }, select: { id: true } }));

    // Leaves first: activity/lesson junctions.
    await tx.activitySkill.deleteMany({ where: { OR: [{ activityId: { in: activityIds } }, { skillId: { in: skillIds } }] } });
    await tx.activityMedia.deleteMany({ where: { activityId: { in: activityIds } } });
    await tx.lessonPrerequisite.deleteMany({ where: { OR: [{ lessonId: { in: lessonIds } }, { prerequisiteLessonId: { in: lessonIds } }] } });
    await tx.lessonSkill.deleteMany({ where: { OR: [{ lessonId: { in: lessonIds } }, { skillId: { in: skillIds } }] } });

    // Skill-level expectations (+ their revisions); clear the current-revision pointer first so the revision is deletable.
    await tx.skillLevelExpectation.updateMany({ where: { skillId: { in: skillIds } }, data: { currentRevisionId: null } });
    await tx.skillLevelExpectationRevision.deleteMany({ where: { expectation: { skillId: { in: skillIds } } } });
    await tx.skillLevelExpectation.deleteMany({ where: { skillId: { in: skillIds } } });

    // Hierarchy bottom-up. Activity→LessonRevision is Cascade, but delete explicitly for clarity; clear published pointer.
    await tx.lesson.updateMany({ where: { id: { in: lessonIds } }, data: { publishedRevisionId: null } });
    await tx.activity.deleteMany({ where: { lessonRevisionId: { in: revisionIds } } });
    await tx.lessonRevision.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await tx.lesson.deleteMany({ where: { topicId: { in: topicIds } } });
    await tx.topic.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await tx.module.deleteMany({ where: { levelId: { in: levelIds } } });
    await tx.level.deleteMany({ where: { trackId: { in: trackIds } } });
    await tx.track.deleteMany({ where: { subjectId } });

    // Skills, then domains (Skill.primaryDomainId → SubjectDomain is RESTRICT, so skills go first), then draft assessments.
    await tx.skill.deleteMany({ where: { subjectId } });
    await tx.subjectDomain.deleteMany({ where: { subjectId } });
    await tx.checkpoint.deleteMany({ where: { subjectId } });
    await tx.assessmentDefinition.deleteMany({ where: { subjectId } });

    // Operational: the subject's own assignments (incl. the creator self-assignment).
    await tx.subjectAssignment.deleteMany({ where: { subjectId } });

    // Finally the Subject. Any residual RESTRICT child (e.g. an authored roadmap-point graph) raises P2003 here → the
    // whole transaction rolls back and the service archives instead.
    await tx.subject.delete({ where: { id: subjectId } });
  }

  // ── SubjectAssignment ──
  createAssignment(tx: Prisma.TransactionClient, data: { userId: string; subjectId: string; assignedBy: string }) {
    return tx.subjectAssignment.create({ data, select: ASSIGNMENT_SELECT });
  }
  findAssignment(userId: string, subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subjectAssignment.findUnique({ where: { userId_subjectId: { userId, subjectId } }, select: ASSIGNMENT_SELECT });
  }
  listAssignments(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).subjectAssignment.findMany({ where: { subjectId }, select: ASSIGNMENT_SELECT, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }] });
  }
  deleteAssignment(tx: Prisma.TransactionClient, userId: string, subjectId: string) {
    return tx.subjectAssignment.deleteMany({ where: { userId, subjectId } });
  }

  userExists(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).user.findUnique({ where: { id }, select: { id: true } });
  }
}

const SUBJECT_SELECT = { id: true, slug: true, title: true, description: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.SubjectSelect;
const ASSIGNMENT_SELECT = { id: true, userId: true, subjectId: true, assignedAt: true, assignedBy: true } satisfies Prisma.SubjectAssignmentSelect;
