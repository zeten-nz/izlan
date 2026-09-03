import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentAssignmentInvalidError, ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentReorderInvalidError, ContentUniqueConflictError } from '../common/errors';
import { SubjectRepository } from './subject.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentAssignment, presentSubject } from './presenters';
import { isUniqueViolation } from './hierarchy.repository';
import { CreateSubjectDto, ReorderSubjectsDto, UpdateSubjectDto } from './dto/subject.dto';

/** Spacing between canonical subject positions — leaves room to insert between without an immediate global rewrite. */
const SUBJECT_ORDER_STEP = 100;

/**
 * Subject + SubjectAssignment authoring (Phase 2.2A-1). Final permission semantics:
 *  - Subject discovery/detail (GET/list) → `content.author` + SubjectAssignment scope;
 *  - Subject CREATE → `content.subject.manage`;
 *  - Subject metadata PATCH → `content.subject.manage` (a GLOBAL top-level capability — no per-subject assignment);
 *  - SubjectAssignment management → `content.subject.manage`.
 * Every mutation writes its StaffAudit inside the SAME transaction (§18/19). No role-name bypass anywhere.
 */
@Injectable()
export class SubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: SubjectRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  /** Subjects the actor may author in (content.author) — those they hold an assignment for. */
  async listAssignedSubjects(userId: string) {
    return (await this.subjects.listAssignedSubjects(userId)).map(presentSubject);
  }

  /** Subject detail — content.author + assignment scope (IDOR-safe: unknown/out-of-scope → not found). */
  async getSubject(userId: string, id: string) {
    const s = await this.subjects.findSubject(id);
    if (!s) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, s.id);
    return presentSubject(s);
  }

  /**
   * Create a DRAFT Subject + self-assignment + audit in ONE transaction (§7). content.subject.manage. Ordering is
   * server-assigned: a transaction advisory lock serializes concurrent creates, then the new subject takes
   * MAX(sortOrder)+STEP so the list stays 100,200,300,… without the client ever sending a position.
   */
  async createSubject(actorUserId: string, dto: CreateSubjectDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.subjects.lockSubjectOrdering(tx); // serialize sortOrder assignment across concurrent creates
        const nextSortOrder = (await this.subjects.maxSortOrder(tx) ?? 0) + SUBJECT_ORDER_STEP;
        const subject = await this.subjects.createSubject(tx, {
          slug: dto.slug, title: dto.title, description: dto.description ?? null, sortOrder: nextSortOrder, createdBy: actorUserId,
        });
        await this.subjects.createAssignment(tx, { userId: actorUserId, subjectId: subject.id, assignedBy: actorUserId });
        await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.SUBJECT_CREATE, targetType: CONTENT_TARGET.SUBJECT, targetId: subject.id, metadata: { slug: subject.slug } });
        return presentSubject(subject);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  /**
   * Canonically reorder the actor's manageable subjects (content.subject.manage). The payload must be the EXACT set
   * of the actor's assigned subjects (unique, complete, no foreign ids) — mirroring the activity-reorder contract.
   * Positions are rewritten to STEP·index in one transaction; a single audit event is written. Backend-authoritative:
   * the client never computes the stored values.
   */
  async reorderSubjects(actorUserId: string, dto: ReorderSubjectsDto) {
    const ordered = dto.orderedSubjectIds;
    if (new Set(ordered).size !== ordered.length) throw new ContentReorderInvalidError('duplicate id');
    return await this.prisma.$transaction(async (tx) => {
      await this.subjects.lockSubjectOrdering(tx);
      const currentSet = new Set(await this.subjects.assignedSubjectIds(actorUserId, tx));
      if (ordered.length !== currentSet.size) throw new ContentReorderInvalidError('set mismatch'); // complete set only
      for (const id of ordered) if (!currentSet.has(id)) throw new ContentReorderInvalidError('unknown id'); // no foreign/out-of-scope id
      for (let i = 0; i < ordered.length; i++) await this.subjects.setSortOrder(tx, ordered[i], (i + 1) * SUBJECT_ORDER_STEP);
      await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.SUBJECT_REORDER, targetType: CONTENT_TARGET.SUBJECT, targetId: null, metadata: { count: ordered.length } });
      return { orderedSubjectIds: ordered };
    });
  }

  /**
   * Update Subject metadata — **content.subject.manage** (global top-level capability; NO per-subject assignment
   * required, unlike child content). DRAFT-only, optimistic concurrency, audited (§12/13/16). Existence + status +
   * concurrency are all resolved inside the mutation transaction.
   */
  async updateSubject(userId: string, id: string, dto: UpdateSubjectDto) {
    const data: Prisma.SubjectUpdateManyMutationInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    const expected = new Date(dto.expectedUpdatedAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const s = await this.subjects.findSubject(id, tx);
        if (!s) throw new ContentNotFoundError('not found');
        if (s.status !== ContainerStatus.DRAFT) throw new ContentNotDraftError('not draft');
        const res = await this.subjects.updateSubjectConditional(tx, id, expected, data);
        if (res.count === 0) throw new ContentEditConflictError('edit conflict');
        const updated = await this.subjects.findSubject(id, tx);
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.SUBJECT_UPDATE, targetType: CONTENT_TARGET.SUBJECT, targetId: id, metadata: { fields: Object.keys(data) } });
        return presentSubject(updated!);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  // ── SubjectAssignment (content.subject.manage) ──

  async listAssignments(subjectId: string) {
    const s = await this.subjects.findSubject(subjectId);
    if (!s) throw new ContentNotFoundError('not found');
    return (await this.subjects.listAssignments(subjectId)).map(presentAssignment);
  }

  /** Idempotent assign (unique(userId,subjectId) authority): re-assigning returns the existing row, no dup, no audit. */
  async assignUser(actorUserId: string, subjectId: string, targetUserId: string) {
    const subject = await this.subjects.findSubject(subjectId);
    if (!subject) throw new ContentNotFoundError('not found');
    const target = await this.subjects.userExists(targetUserId);
    if (!target) throw new ContentAssignmentInvalidError('unknown user');
    const existing = await this.subjects.findAssignment(targetUserId, subjectId);
    if (existing) return presentAssignment(existing);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const a = await this.subjects.createAssignment(tx, { userId: targetUserId, subjectId, assignedBy: actorUserId });
        await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.ASSIGNMENT_ADD, targetType: CONTENT_TARGET.SUBJECT_ASSIGNMENT, targetId: a.id, metadata: { subjectId, userId: targetUserId } });
        return presentAssignment(a);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const a = await this.subjects.findAssignment(targetUserId, subjectId);
        if (a) return presentAssignment(a);
      }
      throw e;
    }
  }

  /** Idempotent remove: removing a missing assignment is a safe no-op (no audit). */
  async removeAssignment(actorUserId: string, subjectId: string, targetUserId: string) {
    const subject = await this.subjects.findSubject(subjectId);
    if (!subject) throw new ContentNotFoundError('not found');
    const existing = await this.subjects.findAssignment(targetUserId, subjectId);
    if (!existing) return { removed: false };
    return await this.prisma.$transaction(async (tx) => {
      const res = await this.subjects.deleteAssignment(tx, targetUserId, subjectId);
      if (res.count > 0) {
        await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.ASSIGNMENT_REMOVE, targetType: CONTENT_TARGET.SUBJECT_ASSIGNMENT, targetId: existing.id, metadata: { subjectId, userId: targetUserId } });
      }
      return { removed: res.count > 0 };
    });
  }
}
