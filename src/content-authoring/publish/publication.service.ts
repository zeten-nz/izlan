import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  ContentEditConflictError,
  ContentLifecycleConflictError,
  ContentNotFoundError,
  ContentPublicationStateInvalidError,
  ContentPublishNotReadyError,
  ContentReviewNotReadyError,
} from '../../common/errors';
import { RevisionRepository } from '../revision.repository';
import { HierarchyRepository } from '../hierarchy.repository';
import { ActivityRepository } from '../activity.repository';
import { SubjectScopeService } from '../subject-scope.service';
import { ContentAuditRepository } from '../content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from '../content-authoring.constants';
import { presentRevision } from '../presenters';
import { projectActivityForLearnerRuntime } from '../../content/activity/learner-activity-projection';
import { PublicationReadinessService } from './publication-readiness.service';
import { PublishRepository } from './publish.repository';
import { ActivityMediaRepository } from '../activity-media.repository';
import { PublishRevisionDto, ReturnToDraftDto, SubmitReviewDto } from '../dto/revision-workflow.dto';
import { ArchiveLessonDto } from '../dto/lesson-archive.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();

/**
 * Review + publication workflow (Phase 2.2B, TD-250). submit-review (content.author) and return-to-draft / publish /
 * takedown (content.publish), all SubjectAssignment-scoped inside the transaction. Publication + takedown serialize on
 * the Lesson row (`FOR UPDATE`) and switch the current-revision pointer atomically (old PUBLISHED → ARCHIVED, new
 * REVIEW → PUBLISHED, Lesson.publishedRevisionId moved) with StaffAudit in the same transaction.
 */
@Injectable()
export class PublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: RevisionRepository,
    private readonly hierarchy: HierarchyRepository,
    private readonly activities: ActivityRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
    private readonly readiness: PublicationReadinessService,
    private readonly publishRepo: PublishRepository,
    private readonly activityMedia: ActivityMediaRepository,
  ) {}

  // ── Reads (content.author + scope) ──
  async getReadiness(userId: string, revisionId: string) {
    const rev = await this.revisions.findRevisionScoped(revisionId);
    if (!rev) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, rev.subjectId);
    return (await this.readiness.evaluate(revisionId))!;
  }

  async preview(userId: string, revisionId: string) {
    const rev = await this.revisions.findRevisionScoped(revisionId);
    if (!rev) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, rev.subjectId);
    const acts = await this.activities.listByRevision(revisionId);
    const mediaByActivity = await this.activityMedia.mediaByRevision(revisionId); // safe media fields only (no storageKey)
    return {
      revisionId: rev.id, lessonId: rev.lessonId, version: rev.version, status: rev.status,
      title: rev.title, description: rev.description, estimatedDurationMin: rev.estimatedDurationMin,
      activities: acts.map((a) => projectActivityForLearnerRuntime({ id: a.id, type: a.type, position: a.position, payload: a.payload, media: mediaByActivity.get(a.id) })),
    };
  }

  // ── DRAFT → REVIEW (content.author) ──
  async submitReview(userId: string, revisionId: string, dto: SubmitReviewDto) {
    return await this.prisma.$transaction(async (tx) => {
      const rev = await this.revisions.findRevisionScoped(revisionId, tx);
      if (!rev) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, rev.subjectId, tx);
      if (rev.status !== RevisionStatus.DRAFT) throw new ContentLifecycleConflictError('not draft');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const report = await this.readiness.evaluate(revisionId, tx);
      if (!report || !report.reviewReady) throw new ContentReviewNotReadyError('not review-ready');
      const res = await this.publishRepo.submitReview(tx, revisionId, rev.updatedAt, userId);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.REVISION_SUBMIT_REVIEW, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: revisionId, metadata: { lessonId: rev.lessonId, revisionVersion: rev.version } });
      return presentRevision((await this.revisions.findRevisionScoped(revisionId, tx))!);
    });
  }

  // ── REVIEW → DRAFT (content.publish) ──
  async returnToDraft(userId: string, revisionId: string, dto: ReturnToDraftDto) {
    return await this.prisma.$transaction(async (tx) => {
      const rev = await this.revisions.findRevisionScoped(revisionId, tx);
      if (!rev) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, rev.subjectId, tx);
      if (rev.status !== RevisionStatus.REVIEW) throw new ContentLifecycleConflictError('not in review');
      if (!sameToken(dto.expectedUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const res = await this.publishRepo.returnToDraft(tx, revisionId, rev.updatedAt, userId);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.REVISION_RETURN_DRAFT, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: revisionId, reason: dto.reason, metadata: { lessonId: rev.lessonId, revisionVersion: rev.version } });
      return presentRevision((await this.revisions.findRevisionScoped(revisionId, tx))!);
    });
  }

  // ── REVIEW → PUBLISHED (content.publish) — atomic pointer switch, Lesson-row serialized ──
  async publish(userId: string, revisionId: string, dto: PublishRevisionDto) {
    return await this.prisma.$transaction(async (tx) => {
      const revInit = await this.revisions.findRevisionScoped(revisionId, tx);
      if (!revInit) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, revInit.subjectId, tx);
      await this.publishRepo.lockLesson(tx, revInit.lessonId); // serialize publish/takedown for this Lesson
      // authoritative re-read after the lock
      const rev = (await this.revisions.findRevisionScoped(revisionId, tx))!;
      const lesson = await this.hierarchy.findLessonScoped(revInit.lessonId, tx);
      if (!lesson) throw new ContentNotFoundError('not found');

      // Idempotent republish (§21): a no-op is allowed ONLY when the requested revision is the FULLY-COHERENT current
      // publication — Lesson PUBLISHED AND Revision PUBLISHED AND pointer == this revision AND revision belongs to this
      // Lesson. After an urgent takedown the pointer/revision are unchanged but Lesson.status == ARCHIVED, so this
      // (correctly) does NOT match and never silently "restores" the lesson (Blocker B).
      if (
        lesson.status === LessonStatus.PUBLISHED &&
        rev.status === RevisionStatus.PUBLISHED &&
        lesson.publishedRevisionId === revisionId &&
        rev.lessonId === lesson.id
      ) {
        return this.publicationView(tx, lesson.id, revisionId);
      }

      // A taken-down (ARCHIVED) Lesson can never be (re)published — deterministic lifecycle conflict BEFORE any OCC
      // token comparison, so republish-after-takedown always fails safe with no restore, no timestamp change, no audit
      // regardless of which (possibly stale) tokens the caller supplied (Blocker B).
      if (lesson.status === LessonStatus.ARCHIVED) throw new ContentLifecycleConflictError('lesson archived');

      // Actual publication: validate both aggregate tokens.
      if (!sameToken(dto.expectedRevisionUpdatedAt, rev.updatedAt)) throw new ContentEditConflictError('edit conflict');
      if (!sameToken(dto.expectedLessonUpdatedAt, lesson.updatedAt)) throw new ContentEditConflictError('edit conflict');
      if (rev.status !== RevisionStatus.REVIEW) throw new ContentLifecycleConflictError('not in review'); // no direct DRAFT→PUBLISHED

      const report = await this.readiness.evaluate(revisionId, tx);
      if (!report || !report.publishReady) throw new ContentPublishNotReadyError('not publish-ready');

      // Replace the current published revision (if any) — pointer must be coherent (§19/43).
      const previousPublishedRevisionId = lesson.publishedRevisionId;
      if (previousPublishedRevisionId !== null) {
        const old = await this.revisions.findRevisionScoped(previousPublishedRevisionId, tx);
        if (!old || old.lessonId !== lesson.id || old.status !== RevisionStatus.PUBLISHED) throw new ContentPublicationStateInvalidError('incoherent pointer');
        const archived = await this.publishRepo.archiveOldRevision(tx, previousPublishedRevisionId, lesson.id, old.updatedAt, userId);
        if (archived.count === 0) throw new ContentPublicationStateInvalidError('archive failed');
      }

      // Duration cache (§29): sum only when ALL activities have a duration; else null (warning already reported).
      const durations = await tx.activity.findMany({ where: { lessonRevisionId: revisionId }, select: { estimatedDurationMin: true } });
      const totalDuration = durations.length > 0 && durations.every((d) => d.estimatedDurationMin !== null) ? durations.reduce((s, d) => s + (d.estimatedDurationMin ?? 0), 0) : null;

      const publishedRes = await this.publishRepo.publishRevision(tx, revisionId, rev.updatedAt, userId, new Date(), totalDuration);
      if (publishedRes.count === 0) throw new ContentEditConflictError('edit conflict');
      const moved = await this.publishRepo.moveLessonPointer(tx, lesson.id, lesson.updatedAt, revisionId);
      if (moved.count === 0) throw new ContentEditConflictError('edit conflict');

      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.REVISION_PUBLISH, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: revisionId, metadata: { subjectId: rev.subjectId, lessonId: lesson.id, revisionVersion: rev.version, previousPublishedRevisionId, firstPublication: previousPublishedRevisionId === null } });
      return this.publicationView(tx, lesson.id, revisionId);
    });
  }

  // ── Urgent takedown: PUBLISHED Lesson → ARCHIVED (content.publish) ──
  async archiveLesson(userId: string, lessonId: string, dto: ArchiveLessonDto) {
    return await this.prisma.$transaction(async (tx) => {
      const init = await this.hierarchy.findLessonScoped(lessonId, tx);
      if (!init) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, init.subjectId, tx);
      await this.publishRepo.lockLesson(tx, lessonId);
      const lesson = (await this.hierarchy.findLessonScoped(lessonId, tx))!;
      if (lesson.status !== LessonStatus.PUBLISHED) throw new ContentLifecycleConflictError('lesson not published');
      if (!sameToken(dto.expectedLessonUpdatedAt, lesson.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const res = await this.publishRepo.archiveLesson(tx, lessonId, lesson.updatedAt);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LESSON_ARCHIVE, targetType: CONTENT_TARGET.LESSON, targetId: lessonId, reason: dto.reason, metadata: { subjectId: lesson.subjectId } });
      const after = await this.hierarchy.findLessonScoped(lessonId, tx);
      return { lessonId, status: after!.status, publishedRevisionId: after!.publishedRevisionId, updatedAt: after!.updatedAt.toISOString() };
    });
  }

  private async publicationView(tx: Prisma.TransactionClient, lessonId: string, revisionId: string) {
    const lesson = (await this.hierarchy.findLessonScoped(lessonId, tx))!;
    const revision = (await this.revisions.findRevisionScoped(revisionId, tx))!;
    return { lesson: { id: lesson.id, status: lesson.status, publishedRevisionId: lesson.publishedRevisionId }, revision: presentRevision(revision) };
  }
}
