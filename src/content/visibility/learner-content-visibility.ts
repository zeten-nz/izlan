import { ContainerStatus, LessonStatus, Prisma, RevisionStatus } from '@prisma/client';

/**
 * THE canonical learner content-visibility authority (Phase 2.2B, TD-250, §34/35). ONE semantic source of truth for
 * "is this Lesson currently learner-visible via its current published revision", replacing the incomplete per-repo
 * checks (which stopped at Level and skipped pointer coherence). The full gate requires the ENTIRE hierarchy published
 * — Subject → Track → Level → Module → Topic → Lesson — plus current-pointer coherence.
 */

/** Canonical select for evaluating current visibility in code (bulk paths). */
export const LEARNER_VISIBILITY_SELECT = {
  id: true,
  status: true,
  publishedRevisionId: true,
  topic: {
    select: {
      status: true,
      module: { select: { status: true, level: { select: { status: true, track: { select: { status: true, subject: { select: { status: true } } } } } } } },
    },
  },
  publishedRevision: { select: { id: true, status: true, lessonId: true } },
} satisfies Prisma.LessonSelect;

export type LessonVisibilityRow = {
  id: string;
  status: LessonStatus;
  publishedRevisionId: string | null;
  topic: { status: ContainerStatus; module: { status: ContainerStatus; level: { status: ContainerStatus; track: { status: ContainerStatus; subject: { status: ContainerStatus } } } } };
  publishedRevision: { id: string; status: RevisionStatus; lessonId: string } | null;
};

/** Is the full hierarchy (Subject → Topic) published for this Lesson? (Excludes revision-pointer coherence.) */
export function isHierarchyPublished(l: LessonVisibilityRow): boolean {
  const t = l.topic;
  return (
    t.status === ContainerStatus.PUBLISHED &&
    t.module.status === ContainerStatus.PUBLISHED &&
    t.module.level.status === ContainerStatus.PUBLISHED &&
    t.module.level.track.status === ContainerStatus.PUBLISHED &&
    t.module.level.track.subject.status === ContainerStatus.PUBLISHED
  );
}

/**
 * THE current-visibility predicate: Lesson PUBLISHED + full hierarchy PUBLISHED + current-pointer coherence
 * (publishedRevisionId set, the pointed revision is PUBLISHED and belongs to THIS Lesson). Used for NEW learner starts
 * and roadmap current-eligibility.
 */
export function isLessonCurrentlyVisible(l: LessonVisibilityRow): boolean {
  return (
    l.status === LessonStatus.PUBLISHED &&
    l.publishedRevisionId !== null &&
    l.publishedRevision !== null &&
    l.publishedRevision.id === l.publishedRevisionId &&
    l.publishedRevision.status === RevisionStatus.PUBLISHED &&
    l.publishedRevision.lessonId === l.id &&
    isHierarchyPublished(l)
  );
}

/** The reusable hierarchy-published Lesson `where` fragment (Lesson PUBLISHED + Subject→Topic PUBLISHED). */
export const publishedHierarchyLessonWhere: Prisma.LessonWhereInput = {
  status: LessonStatus.PUBLISHED,
  topic: { status: ContainerStatus.PUBLISHED, module: { status: ContainerStatus.PUBLISHED, level: { status: ContainerStatus.PUBLISHED, track: { status: ContainerStatus.PUBLISHED, subject: { status: ContainerStatus.PUBLISHED } } } } },
};

/**
 * `where` for a specific Lesson that is CURRENTLY learner-visible via its current published revision — full hierarchy +
 * pointer coherence (`publishedRevision.status = PUBLISHED` AND `publishedRevision.lessonId = lessonId`). Selecting
 * `publishedRevisionId` under this `where` yields the current revision id, or null when not visible.
 */
export function currentVisibleLessonWhere(lessonId: string): Prisma.LessonWhereInput {
  return {
    id: lessonId,
    ...publishedHierarchyLessonWhere,
    publishedRevisionId: { not: null },
    publishedRevision: { status: RevisionStatus.PUBLISHED, lessonId },
  };
}

/** `where` for a Lesson that is RESUMABLE by an already-pinned learner: Lesson + hierarchy PUBLISHED (the pinned
 *  revision may be ARCHIVED after a replacement). Used to deny resume after an urgent takedown (§36B/38). */
export function resumableLessonWhere(lessonId: string): Prisma.LessonWhereInput {
  return { id: lessonId, ...publishedHierarchyLessonWhere };
}
