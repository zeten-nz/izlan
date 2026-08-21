import { Injectable } from '@nestjs/common';
import { Prisma, SkillStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotFoundError, ContentSkillArchivedError, ContentUniqueConflictError } from '../common/errors';
import { SkillRepository } from './skill.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { isUniqueViolation } from './hierarchy.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentSkill } from './presenters';
import { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto';

/**
 * Subject-scoped Skill authoring (Phase 2.2A-3). No hard delete / merge / archive lifecycle here. content.author +
 * SubjectAssignment (from `Skill.subjectId`). ACTIVE-only metadata edits with strict-monotonic `updatedAt` OCC;
 * StaffAudit in the same transaction. Skills cannot move between Subjects.
 */
@Injectable()
export class SkillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  async listSkills(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    return (await this.skills.listBySubject(subjectId)).map(presentSkill);
  }

  async getSkill(userId: string, skillId: string) {
    const s = await this.skills.findById(skillId);
    if (!s) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, s.subjectId);
    return presentSkill(s);
  }

  async createSkill(userId: string, subjectId: string, dto: CreateSkillDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.scope.requireScope(userId, subjectId, tx); // subject exists AND actor assigned — INSIDE the tx (no pre-tx read)
        const skill = await this.skills.createSkill(tx, { subjectId, name: dto.name, code: dto.code ?? null, description: dto.description ?? null, sortOrder: dto.sortOrder ?? 0 });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.SKILL_CREATE, targetType: CONTENT_TARGET.SKILL, targetId: skill.id, metadata: { subjectId } });
        return presentSkill(skill);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict'); // duplicate name/code in subject
      throw e;
    }
  }

  async updateSkill(userId: string, skillId: string, dto: UpdateSkillDto) {
    const data: Prisma.SkillUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    const expected = new Date(dto.expectedUpdatedAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const s = await this.skills.findById(skillId, tx);
        if (!s) throw new ContentNotFoundError('not found');
        await this.scope.requireScope(userId, s.subjectId, tx);
        if (s.status !== SkillStatus.ACTIVE) throw new ContentSkillArchivedError('archived'); // no restore/archive via PATCH
        const res = await this.skills.updateSkillConditional(tx, skillId, expected, data);
        if (res.count === 0) throw new ContentEditConflictError('edit conflict');
        const updated = await this.skills.findById(skillId, tx);
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.SKILL_UPDATE, targetType: CONTENT_TARGET.SKILL, targetId: skillId, metadata: { subjectId: s.subjectId, fields: Object.keys(data) } });
        return presentSkill(updated!);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }
}
