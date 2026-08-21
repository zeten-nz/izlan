import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentPrerequisiteCycleError, ContentPrerequisiteInvalidError, ContentUniqueConflictError } from '../common/errors';
import { PrerequisiteRepository } from './prerequisite.repository';
import { HierarchyRepository, isUniqueViolation } from './hierarchy.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentPrerequisiteLesson } from './presenters';
import { wouldCreatePrerequisiteCycle } from './prerequisite-graph';
import { AddPrerequisiteDto, RemovePrerequisiteDto } from './dto/prerequisite.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();

/**
 * LessonPrerequisite authoring with transactional full-DAG cycle prevention (Phase 2.2A-3, TD-249). The prerequisite
 * graph is the EXISTING roadmap authority. Edges stay inside ONE Subject; the SOURCE Lesson must be DRAFT; the target
 * may be DRAFT or PUBLISHED (never ARCHIVED). Graph mutations for a Subject are serialized by locking the Subject row
 * (`SELECT … FOR UPDATE`) BEFORE reading the whole-Subject graph + cycle-checking + writing — so two concurrent
 * inverse-edge writers cannot both commit a cycle. Lesson.updatedAt is the aggregate OCC token.
 */
@Injectable()
export class PrerequisiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prereqs: PrerequisiteRepository,
    private readonly hierarchy: HierarchyRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async listPrerequisites(userId: string, lessonId: string) {
    const lesson = await this.hierarchy.findLessonScoped(lessonId);
    await this.scope.requireScope(userId, lesson ? lesson.subjectId : null);
    return (await this.prereqs.listPrerequisites(lessonId)).map(presentPrerequisiteLesson);
  }

  async addPrerequisite(userId: string, lessonId: string, dto: AddPrerequisiteDto) {
    const prerequisiteLessonId = dto.prerequisiteLessonId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await this.hierarchy.findLessonScoped(lessonId, tx);
        if (!source) throw new ContentNotFoundError('not found');
        await this.scope.requireScope(userId, source.subjectId, tx);
        const target = await this.hierarchy.findLessonScoped(prerequisiteLessonId, tx);
        if (!target || target.subjectId !== source.subjectId) throw new ContentNotFoundError('not found'); // cross-subject / missing → IDOR-safe
        if (source.status !== LessonStatus.DRAFT) throw new ContentNotDraftError('source not draft'); // live-graph guard (§20)
        if (target.status === LessonStatus.ARCHIVED) throw new ContentPrerequisiteInvalidError('target archived');
        if (lessonId === prerequisiteLessonId) throw new ContentPrerequisiteInvalidError('self loop'); // service-level, before the DB CHECK

        await this.prereqs.lockSubject(tx, source.subjectId); // serialize graph mutations for this Subject
        const current = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
        if (!current || !sameToken(dto.expectedLessonUpdatedAt, current)) throw new ContentEditConflictError('edit conflict'); // stale even if edge exists
        if (await this.prereqs.findEdge(tx, lessonId, prerequisiteLessonId)) return { lessonUpdatedAt: current.toISOString() }; // idempotent no-op

        const edges = await this.prereqs.edgesForSubject(tx, source.subjectId); // WHOLE-subject graph, read after the lock (§26)
        if (wouldCreatePrerequisiteCycle(edges, lessonId, prerequisiteLessonId)) throw new ContentPrerequisiteCycleError('cycle'); // no touch/edge/audit
        const touched = await this.hierarchy.touchLessonConditional(tx, lessonId, current);
        if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
        await this.prereqs.createEdge(tx, lessonId, prerequisiteLessonId);
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.PREREQUISITE_ADD, targetType: CONTENT_TARGET.LESSON, targetId: lessonId, metadata: { subjectId: source.subjectId, prerequisiteLessonId } });
        return { lessonUpdatedAt: await this.lessonIso(tx, lessonId) };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict'); // defensive (edge unique)
      throw e;
    }
  }

  async removePrerequisite(userId: string, lessonId: string, prerequisiteLessonId: string, dto: RemovePrerequisiteDto) {
    return await this.prisma.$transaction(async (tx) => {
      const source = await this.hierarchy.findLessonScoped(lessonId, tx);
      if (!source) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, source.subjectId, tx);
      if (source.status !== LessonStatus.DRAFT) throw new ContentNotDraftError('source not draft');
      await this.prereqs.lockSubject(tx, source.subjectId); // same serialization order for ADD/REMOVE (§28)
      const current = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
      if (!current || !sameToken(dto.expectedLessonUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
      if (!(await this.prereqs.findEdge(tx, lessonId, prerequisiteLessonId))) return { lessonUpdatedAt: current.toISOString() }; // idempotent no-op (removal cannot create a cycle)
      const touched = await this.hierarchy.touchLessonConditional(tx, lessonId, current);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.prereqs.deleteEdge(tx, lessonId, prerequisiteLessonId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.PREREQUISITE_REMOVE, targetType: CONTENT_TARGET.LESSON, targetId: lessonId, metadata: { subjectId: source.subjectId, prerequisiteLessonId } });
      return { lessonUpdatedAt: await this.lessonIso(tx, lessonId) };
    });
  }

  private async lessonIso(tx: Prisma.TransactionClient, lessonId: string): Promise<string> {
    const at = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
    if (!at) throw new ContentNotFoundError('not found');
    return at.toISOString();
  }
}
