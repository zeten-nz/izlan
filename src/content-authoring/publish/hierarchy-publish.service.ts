import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ContentEditConflictError, ContentLifecycleConflictError, ContentNotFoundError } from '../../common/errors';
import { SubjectRepository } from '../subject.repository';
import { HierarchyRepository } from '../hierarchy.repository';
import { SubjectScopeService } from '../subject-scope.service';
import { ContentAuditRepository } from '../content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from '../content-authoring.constants';
import { ConcurrentEditDto } from '../dto/common.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();
type PublishRead = { status: ContainerStatus; updatedAt: Date; subjectId: string; ancestors: ContainerStatus[] };

/**
 * Explicit top-down hierarchy publication (Phase 2.2B, §8-10). content.publish + SubjectAssignment (inside the tx).
 * A container may go DRAFT → PUBLISHED only when its full ancestor chain is already PUBLISHED (no auto-publish of
 * parents). Strict-monotonic `updatedAt` OCC; StaffAudit in the same transaction.
 */
@Injectable()
export class HierarchyPublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: SubjectRepository,
    private readonly hierarchy: HierarchyRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async publishSubject(userId: string, subjectId: string, dto: ConcurrentEditDto) {
    return await this.prisma.$transaction(async (tx) => {
      const s = await this.subjects.findSubject(subjectId, tx);
      if (!s) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, s.id, tx);
      if (s.status !== ContainerStatus.DRAFT) throw new ContentLifecycleConflictError('not draft');
      if (!sameToken(dto.expectedUpdatedAt, s.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const res = await this.subjects.publishSubjectConditional(tx, subjectId, s.updatedAt);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.SUBJECT_PUBLISH, targetType: CONTENT_TARGET.SUBJECT, targetId: subjectId, metadata: { subjectId } });
      return { id: subjectId, status: ContainerStatus.PUBLISHED, updatedAt: (await this.subjects.findSubject(subjectId, tx))!.updatedAt.toISOString() };
    });
  }

  publishTrack(userId: string, id: string, dto: ConcurrentEditDto) {
    return this.publishContainer(userId, id, dto, (tx, i) => this.hierarchy.findTrackForPublish(i, tx), (tx, i, at) => this.hierarchy.publishTrackConditional(tx, i, at), CONTENT_AUDIT.TRACK_PUBLISH, CONTENT_TARGET.TRACK);
  }
  publishLevel(userId: string, id: string, dto: ConcurrentEditDto) {
    return this.publishContainer(userId, id, dto, (tx, i) => this.hierarchy.findLevelForPublish(i, tx), (tx, i, at) => this.hierarchy.publishLevelConditional(tx, i, at), CONTENT_AUDIT.LEVEL_PUBLISH, CONTENT_TARGET.LEVEL);
  }
  publishModule(userId: string, id: string, dto: ConcurrentEditDto) {
    return this.publishContainer(userId, id, dto, (tx, i) => this.hierarchy.findModuleForPublish(i, tx), (tx, i, at) => this.hierarchy.publishModuleConditional(tx, i, at), CONTENT_AUDIT.MODULE_PUBLISH, CONTENT_TARGET.MODULE);
  }
  publishTopic(userId: string, id: string, dto: ConcurrentEditDto) {
    return this.publishContainer(userId, id, dto, (tx, i) => this.hierarchy.findTopicForPublish(i, tx), (tx, i, at) => this.hierarchy.publishTopicConditional(tx, i, at), CONTENT_AUDIT.TOPIC_PUBLISH, CONTENT_TARGET.TOPIC);
  }

  private async publishContainer(
    userId: string,
    id: string,
    dto: ConcurrentEditDto,
    read: (tx: Prisma.TransactionClient, id: string) => Promise<PublishRead | null>,
    publish: (tx: Prisma.TransactionClient, id: string, expected: Date) => Promise<{ count: number }>,
    actionCode: string,
    targetType: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const c = await read(tx, id);
      if (!c) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, c.subjectId, tx);
      if (c.status !== ContainerStatus.DRAFT) throw new ContentLifecycleConflictError('not draft');
      if (c.ancestors.some((a) => a !== ContainerStatus.PUBLISHED)) throw new ContentLifecycleConflictError('parent not published'); // §9
      if (!sameToken(dto.expectedUpdatedAt, c.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const res = await publish(tx, id, c.updatedAt);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode, targetType, targetId: id, metadata: { subjectId: c.subjectId } });
      return { id, status: ContainerStatus.PUBLISHED, updatedAt: (await read(tx, id))!.updatedAt.toISOString() };
    });
  }
}
