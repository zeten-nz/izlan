import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * LessonSkill + ActivitySkill mapping persistence (Phase 2.2A-3). These are the EXISTING learner authorities
 * (roadmap Lesson↔Skill, review-session Activity↔Skill) — this writer feeds them; no shadow tables. Concurrency is
 * owned by the aggregate (Lesson.updatedAt / LessonRevision.updatedAt), so the mapping writes here are plain.
 */
@Injectable()
export class MappingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  // ── LessonSkill ──
  findLessonSkill(tx: Prisma.TransactionClient, lessonId: string, skillId: string) {
    return tx.lessonSkill.findUnique({ where: { lessonId_skillId: { lessonId, skillId } }, select: { id: true } });
  }
  createLessonSkill(tx: Prisma.TransactionClient, lessonId: string, skillId: string) {
    return tx.lessonSkill.create({ data: { lessonId, skillId }, select: { id: true } });
  }
  deleteLessonSkill(tx: Prisma.TransactionClient, lessonId: string, skillId: string) {
    return tx.lessonSkill.deleteMany({ where: { lessonId, skillId } });
  }
  listLessonSkills(lessonId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).lessonSkill.findMany({
      where: { lessonId },
      select: { skill: { select: SKILL_MAP_SELECT } },
      orderBy: [{ skill: { sortOrder: 'asc' } }, { skill: { id: 'asc' } }],
    });
  }

  // ── ActivitySkill ──
  findActivitySkill(tx: Prisma.TransactionClient, activityId: string, skillId: string) {
    return tx.activitySkill.findUnique({ where: { activityId_skillId: { activityId, skillId } }, select: { id: true } });
  }
  createActivitySkill(tx: Prisma.TransactionClient, activityId: string, skillId: string) {
    return tx.activitySkill.create({ data: { activityId, skillId }, select: { id: true } });
  }
  deleteActivitySkill(tx: Prisma.TransactionClient, activityId: string, skillId: string) {
    return tx.activitySkill.deleteMany({ where: { activityId, skillId } });
  }
  listActivitySkills(activityId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).activitySkill.findMany({
      where: { activityId },
      select: { skill: { select: SKILL_MAP_SELECT } },
      orderBy: [{ skill: { sortOrder: 'asc' } }, { skill: { id: 'asc' } }],
    });
  }
}

const SKILL_MAP_SELECT = { id: true, name: true, code: true, sortOrder: true, status: true } satisfies Prisma.SkillSelect;
