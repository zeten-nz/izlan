import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentAssignmentInvalidError, ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentUniqueConflictError } from '../common/errors';
import { SubjectRepository } from './subject.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentAssignment, presentSubject } from './presenters';
import { isUniqueViolation } from './hierarchy.repository';
import { CreateSubjectDto, UpdateSubjectDto } from './dto/subject.dto';

/** Postgres FK / required-relation violation (a RESTRICT child still references the row). No raw detail is surfaced. */
const isForeignKeyViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2003' || e.code === 'P2014');

/** Authoritative outcome of a subject-removal request. `reason` is a stable code the client localizes (never FK detail). */
export interface SubjectDeletionResult {
  outcome: 'DELETED' | 'ARCHIVED' | 'BLOCKED';
  subjectId: string;
  title: string;
  reason: 'LEARNER_HISTORY' | 'PUBLISHED_CONTENT' | 'RESIDUAL_CONTENT' | null;
}

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

  /** Create a DRAFT Subject + self-assignment + audit in ONE transaction (§7). content.subject.manage. */
  async createSubject(actorUserId: string, dto: CreateSubjectDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subject = await this.subjects.createSubject(tx, {
          slug: dto.slug, title: dto.title, description: dto.description ?? null, sortOrder: dto.sortOrder ?? 0, createdBy: actorUserId,
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
   * Update Subject metadata — **content.subject.manage** (global top-level capability; NO per-subject assignment
   * required, unlike child content). DRAFT-only, optimistic concurrency, audited (§12/13/16). Existence + status +
   * concurrency are all resolved inside the mutation transaction.
   */
  async updateSubject(userId: string, id: string, dto: UpdateSubjectDto) {
    const data: Prisma.SubjectUpdateManyMutationInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
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

  /**
   * SAFE subject removal (content.subject.manage + assignment scope). Backend is authoritative about what happens:
   *  - BLOCKED  — the subject has learner history; nothing is touched (history must never disappear on a Delete click).
   *  - ARCHIVED — the subject has published content but no history; status → ARCHIVED (hidden from active + learner
   *               surfaces, all rows preserved). Also the safe fallback if a disposable subject still has authored
   *               content the owned-cascade does not cover (the physical delete rolls back atomically).
   *  - DELETED  — a disposable subject (DRAFT, no history, no published content): its owned authoring content is
   *               permanently removed, then the subject.
   * Unknown/out-of-scope → ContentNotFoundError (404, IDOR-safe). Idempotent: a second delete of a removed subject 404s;
   * a second delete of an archived subject re-archives (no-op). Never exposes raw FK/table detail.
   */
  async deleteSubject(actorUserId: string, id: string): Promise<SubjectDeletionResult> {
    const subject = await this.subjects.findSubject(id);
    if (!subject) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(actorUserId, subject.id); // destructive action requires an assignment; no role-name bypass

    if (await this.subjects.hasLearnerHistory(id)) {
      return { outcome: 'BLOCKED', subjectId: id, title: subject.title, reason: 'LEARNER_HISTORY' };
    }

    const archive = async (reason: SubjectDeletionResult['reason']): Promise<SubjectDeletionResult> =>
      this.prisma.$transaction(async (tx) => {
        const archived = await this.subjects.archiveSubject(tx, id);
        await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.SUBJECT_ARCHIVE, targetType: CONTENT_TARGET.SUBJECT, targetId: id, metadata: { slug: archived.slug, reason } });
        return { outcome: 'ARCHIVED', subjectId: id, title: archived.title, reason };
      });

    if (await this.subjects.hasPublishedContent(id, subject.status)) {
      return archive('PUBLISHED_CONTENT');
    }

    // Disposable: permanently delete the owned authoring content + the subject, atomically + audited.
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.audit.write(tx, { actorUserId, actionCode: CONTENT_AUDIT.SUBJECT_DELETE, targetType: CONTENT_TARGET.SUBJECT, targetId: id, metadata: { slug: subject.slug, title: subject.title } });
        await this.subjects.hardDeleteOwnedContent(tx, id);
        return { outcome: 'DELETED', subjectId: id, title: subject.title, reason: null };
      });
    } catch (e) {
      // Residual owned content the cascade does not cover (e.g. an authored roadmap-point graph) → the delete rolled
      // back atomically; retire the subject instead so it still leaves the active list without any data loss.
      if (isForeignKeyViolation(e)) return archive('RESIDUAL_CONTENT');
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
