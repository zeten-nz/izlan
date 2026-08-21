import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentUniqueConflictError } from '../common/errors';
import { RevisionRepository } from './revision.repository';
import { HierarchyRepository, isUniqueViolation } from './hierarchy.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentRevision } from './presenters';
import { CreateRevisionDto, UpdateRevisionDto } from './dto/revision.dto';

/**
 * DRAFT LessonRevision authoring (Phase 2.2A-2). Version is backend-generated (max+1) with a bounded retry around the
 * `@@unique([lessonId, version])` race. content.author + SubjectAssignment (resolved from the Lesson chain), enforced
 * inside the mutation transaction. Only DRAFT revisions are mutable; StaffAudit is written in the same transaction.
 */
@Injectable()
export class RevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisions: RevisionRepository,
    private readonly hierarchy: HierarchyRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async listRevisions(userId: string, lessonId: string) {
    const lesson = await this.hierarchy.findLessonScoped(lessonId);
    await this.scope.requireScope(userId, lesson ? lesson.subjectId : null);
    return (await this.revisions.listByLesson(lessonId)).map(presentRevision);
  }

  async getRevision(userId: string, revisionId: string) {
    const r = await this.revisions.findRevisionScoped(revisionId);
    if (!r) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, r.subjectId);
    return presentRevision(r);
  }

  /** Create a DRAFT revision under a DRAFT or PUBLISHED Lesson (never ARCHIVED). Version = max+1, race-retried. */
  async createRevision(userId: string, lessonId: string, dto: CreateRevisionDto) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const lesson = await this.hierarchy.findLessonScoped(lessonId, tx);
          await this.scope.requireScope(userId, lesson ? lesson.subjectId : null, tx);
          if (lesson!.status === LessonStatus.ARCHIVED) throw new ContentNotDraftError('lesson archived'); // DRAFT/PUBLISHED only (§7)
          const nextVersion = (await this.revisions.maxVersion(tx, lessonId)) + 1;
          const rev = await this.revisions.create(tx, { lessonId, version: nextVersion, title: dto.title, description: dto.description ?? null, createdBy: userId });
          await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.REVISION_CREATE, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: rev.id, metadata: { lessonId, revisionVersion: rev.version } });
          return presentRevision(rev);
        });
      } catch (e) {
        // Only the (lessonId, version) unique can collide here → concurrent create won max+1; retry the whole op.
        if (isUniqueViolation(e) && attempt < 5) continue;
        if (isUniqueViolation(e)) throw new ContentUniqueConflictError('revision version conflict');
        throw e;
      }
    }
    throw new ContentUniqueConflictError('revision version conflict'); // defensive (bounded retry exhausted)
  }

  /** PATCH DRAFT revision metadata (title/description). Optimistic concurrency + audit; updatedBy = actor. */
  async updateRevision(userId: string, revisionId: string, dto: UpdateRevisionDto) {
    const data: Prisma.LessonRevisionUncheckedUpdateManyInput = { updatedBy: userId };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    const expected = new Date(dto.expectedUpdatedAt);
    return await this.prisma.$transaction(async (tx) => {
      const r = await this.revisions.findRevisionScoped(revisionId, tx);
      if (!r) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, r.subjectId, tx);
      if (r.status !== RevisionStatus.DRAFT) throw new ContentNotDraftError('not draft');
      const res = await this.revisions.updateRevisionConditional(tx, revisionId, expected, data);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      const updated = await this.revisions.findRevisionScoped(revisionId, tx);
      const changed = Object.keys(data).filter((k) => k !== 'updatedBy');
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.REVISION_UPDATE, targetType: CONTENT_TARGET.LESSON_REVISION, targetId: revisionId, metadata: { lessonId: r.lessonId, revisionVersion: r.version, fields: changed } });
      return presentRevision(updated!);
    });
  }
}
