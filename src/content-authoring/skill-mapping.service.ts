import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma, RevisionStatus, SkillStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentSkillArchivedError, ContentUniqueConflictError } from '../common/errors';
import { MappingRepository } from './mapping.repository';
import { SkillRepository } from './skill.repository';
import { HierarchyRepository, isUniqueViolation } from './hierarchy.repository';
import { ActivityRepository } from './activity.repository';
import { RevisionRepository } from './revision.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentMappedSkill } from './presenters';
import { AddActivitySkillDto, AddLessonSkillDto, RemoveActivitySkillDto, RemoveLessonSkillDto } from './dto/mapping.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();

/**
 * LessonSkill + ActivitySkill authoring (Phase 2.2A-3). Writes the EXISTING learner authorities. content.author +
 * SubjectAssignment; same-Subject invariant (Skill Subject must equal the Lesson/Activity Subject; cross-subject →
 * IDOR-safe not-found). LessonSkill mutates only a DRAFT logical Lesson (Lesson.updatedAt aggregate token);
 * ActivitySkill mutates only a DRAFT LessonRevision (Revision.updatedAt aggregate token). Idempotent add/remove with
 * a CURRENT token is a no-op (no token advance, no audit); a stale token is 409 even for the already-final state.
 */
@Injectable()
export class SkillMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: MappingRepository,
    private readonly skills: SkillRepository,
    private readonly hierarchy: HierarchyRepository,
    private readonly activities: ActivityRepository,
    private readonly revisions: RevisionRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  // ── LessonSkill (Lesson.updatedAt aggregate token, DRAFT logical Lesson only) ──
  async listLessonSkills(userId: string, lessonId: string) {
    const lesson = await this.hierarchy.findLessonScoped(lessonId);
    await this.scope.requireScope(userId, lesson ? lesson.subjectId : null);
    return (await this.mappings.listLessonSkills(lessonId)).map(presentMappedSkill);
  }

  async addLessonSkill(userId: string, lessonId: string, dto: AddLessonSkillDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lesson = await this.hierarchy.findLessonScoped(lessonId, tx);
        await this.scope.requireScope(userId, lesson ? lesson.subjectId : null, tx);
        if (lesson!.status !== LessonStatus.DRAFT) throw new ContentNotDraftError('lesson not draft'); // live mapping guard (§13)
        const skill = await this.skills.findById(dto.skillId, tx);
        if (!skill || skill.subjectId !== lesson!.subjectId) throw new ContentNotFoundError('not found'); // cross-subject IDOR-safe
        if (skill.status !== SkillStatus.ACTIVE) throw new ContentSkillArchivedError('archived');
        const current = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
        if (!current || !sameToken(dto.expectedLessonUpdatedAt, current)) throw new ContentEditConflictError('edit conflict'); // stale even if already mapped
        if (await this.mappings.findLessonSkill(tx, lessonId, dto.skillId)) return { lessonUpdatedAt: current.toISOString() }; // idempotent no-op
        const touched = await this.hierarchy.touchLessonConditional(tx, lessonId, current);
        if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
        await this.mappings.createLessonSkill(tx, lessonId, dto.skillId);
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LESSON_SKILL_ADD, targetType: CONTENT_TARGET.LESSON, targetId: lessonId, metadata: { subjectId: lesson!.subjectId, skillId: dto.skillId } });
        return { lessonUpdatedAt: await this.lessonIso(tx, lessonId) };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  async removeLessonSkill(userId: string, lessonId: string, skillId: string, dto: RemoveLessonSkillDto) {
    return await this.prisma.$transaction(async (tx) => {
      const lesson = await this.hierarchy.findLessonScoped(lessonId, tx);
      await this.scope.requireScope(userId, lesson ? lesson.subjectId : null, tx);
      if (lesson!.status !== LessonStatus.DRAFT) throw new ContentNotDraftError('lesson not draft');
      const current = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
      if (!current || !sameToken(dto.expectedLessonUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
      if (!(await this.mappings.findLessonSkill(tx, lessonId, skillId))) return { lessonUpdatedAt: current.toISOString() }; // idempotent no-op
      const touched = await this.hierarchy.touchLessonConditional(tx, lessonId, current);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.mappings.deleteLessonSkill(tx, lessonId, skillId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LESSON_SKILL_REMOVE, targetType: CONTENT_TARGET.LESSON, targetId: lessonId, metadata: { subjectId: lesson!.subjectId, skillId } });
      return { lessonUpdatedAt: await this.lessonIso(tx, lessonId) };
    });
  }

  // ── ActivitySkill (LessonRevision.updatedAt aggregate token, DRAFT revision only) ──
  async listActivitySkills(userId: string, activityId: string) {
    const act = await this.activities.findActivityScoped(activityId);
    if (!act) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, act.subjectId);
    return (await this.mappings.listActivitySkills(activityId)).map(presentMappedSkill);
  }

  async addActivitySkill(userId: string, activityId: string, dto: AddActivitySkillDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const act = await this.activities.findActivityScoped(activityId, tx);
        if (!act) throw new ContentNotFoundError('not found');
        await this.scope.requireScope(userId, act.subjectId, tx);
        if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('revision not draft');
        const skill = await this.skills.findById(dto.skillId, tx);
        if (!skill || skill.subjectId !== act.subjectId) throw new ContentNotFoundError('not found');
        if (skill.status !== SkillStatus.ACTIVE) throw new ContentSkillArchivedError('archived');
        const current = await this.revisions.currentUpdatedAt(tx, act.lessonRevisionId);
        if (!current || !sameToken(dto.expectedRevisionUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
        if (await this.mappings.findActivitySkill(tx, activityId, dto.skillId)) return { revisionUpdatedAt: current.toISOString() };
        const touched = await this.revisions.touchRevision(tx, act.lessonRevisionId, current, userId);
        if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
        await this.mappings.createActivitySkill(tx, activityId, dto.skillId);
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_SKILL_ADD, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.lessonRevisionId, skillId: dto.skillId } });
        return { revisionUpdatedAt: await this.revIso(tx, act.lessonRevisionId) };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  async removeActivitySkill(userId: string, activityId: string, skillId: string, dto: RemoveActivitySkillDto) {
    return await this.prisma.$transaction(async (tx) => {
      const act = await this.activities.findActivityScoped(activityId, tx);
      if (!act) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, act.subjectId, tx);
      if (act.revisionStatus !== RevisionStatus.DRAFT) throw new ContentNotDraftError('revision not draft');
      const current = await this.revisions.currentUpdatedAt(tx, act.lessonRevisionId);
      if (!current || !sameToken(dto.expectedRevisionUpdatedAt, current)) throw new ContentEditConflictError('edit conflict');
      if (!(await this.mappings.findActivitySkill(tx, activityId, skillId))) return { revisionUpdatedAt: current.toISOString() };
      const touched = await this.revisions.touchRevision(tx, act.lessonRevisionId, current, userId);
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.mappings.deleteActivitySkill(tx, activityId, skillId);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.ACTIVITY_SKILL_REMOVE, targetType: CONTENT_TARGET.ACTIVITY, targetId: activityId, metadata: { revisionId: act.lessonRevisionId, skillId } });
      return { revisionUpdatedAt: await this.revIso(tx, act.lessonRevisionId) };
    });
  }

  private async lessonIso(tx: Prisma.TransactionClient, lessonId: string): Promise<string> {
    const at = await this.hierarchy.lessonUpdatedAt(tx, lessonId);
    if (!at) throw new ContentNotFoundError('not found');
    return at.toISOString();
  }
  private async revIso(tx: Prisma.TransactionClient, revisionId: string): Promise<string> {
    const at = await this.revisions.currentUpdatedAt(tx, revisionId);
    if (!at) throw new ContentNotFoundError('not found');
    return at.toISOString();
  }
}
