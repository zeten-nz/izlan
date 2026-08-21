import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentEditConflictError, ContentNotDraftError, ContentNotFoundError, ContentUniqueConflictError } from '../common/errors';
import { HierarchyRepository, isUniqueViolation } from './hierarchy.repository';
import { SubjectScopeService } from './subject-scope.service';
import { ContentAuditRepository } from './content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from './content-authoring.constants';
import { presentLesson, presentLevel, presentModule, presentTopic, presentTrack } from './presenters';
import { CreateTrackDto, UpdateTrackDto } from './dto/track.dto';
import { CreateLevelDto, UpdateLevelDto } from './dto/level.dto';
import { CreateModuleDto, UpdateModuleDto } from './dto/module.dto';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
import { CreateLessonDto, MoveLessonDto, UpdateLessonDto } from './dto/lesson.dto';

const isDraft = (status: string): boolean => status === 'DRAFT';

/**
 * Track → Level → Module → Topic → logical Lesson authoring (Phase 2.2A-1). Every child mutation resolves its
 * Subject from DB relationships and requires the actor's SubjectAssignment (§6). Every create/update writes its
 * StaffAudit inside the same transaction (§18/19); updates are DRAFT-only with `updatedAt` optimistic
 * concurrency (§13/16). No parent reparenting except the accepted DRAFT Lesson → Topic move (§14/15).
 */
@Injectable()
export class HierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: HierarchyRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
  ) {}

  /** Audited, scoped, DRAFT-only, optimistic-concurrency PATCH shared by all container/lesson updates. */
  private async runPatch<T>(params: {
    userId: string;
    id: string;
    expectedUpdatedAt: string;
    fields: string[];
    actionCode: string;
    targetType: string;
    load: (tx: Prisma.TransactionClient) => Promise<{ status: string; subjectId: string } | null>;
    conditional: (tx: Prisma.TransactionClient, expected: Date) => Promise<{ count: number }>;
    reload: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    const expected = new Date(params.expectedUpdatedAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await params.load(tx);
        if (!row) throw new ContentNotFoundError('not found');
        await this.scope.requireScope(params.userId, row.subjectId, tx);
        if (!isDraft(row.status)) throw new ContentNotDraftError('not draft');
        const res = await params.conditional(tx, expected);
        if (res.count === 0) throw new ContentEditConflictError('edit conflict');
        const updated = await params.reload(tx);
        await this.audit.write(tx, { actorUserId: params.userId, actionCode: params.actionCode, targetType: params.targetType, targetId: params.id, metadata: { fields: params.fields } });
        return updated;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }

  // ── Track (parent = Subject via route :subjectId) ──
  async createTrack(userId: string, subjectId: string, dto: CreateTrackDto) {
    await this.scope.requireScope(userId, subjectId); // subject must exist AND actor assigned (IDOR-safe)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const track = await this.repo.createTrack(tx, { subjectId, slug: dto.slug, title: dto.title, description: dto.description ?? null, sortOrder: dto.sortOrder ?? 0, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.TRACK_CREATE, targetType: CONTENT_TARGET.TRACK, targetId: track.id, metadata: { subjectId, slug: track.slug } });
        return presentTrack(track);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }
  async listTracks(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    return (await this.repo.listTracks(subjectId)).map(presentTrack);
  }
  async getTrack(userId: string, id: string) {
    const t = await this.repo.findTrack(id);
    if (!t) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, t.subjectId);
    return presentTrack(t);
  }
  async updateTrack(userId: string, id: string, dto: UpdateTrackDto) {
    const data: Prisma.TrackUpdateManyMutationInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.runPatch({
      userId, id, expectedUpdatedAt: dto.expectedUpdatedAt, fields: Object.keys(data),
      actionCode: CONTENT_AUDIT.TRACK_UPDATE, targetType: CONTENT_TARGET.TRACK,
      load: async (tx) => { const t = await this.repo.findTrack(id, tx); return t ? { status: t.status, subjectId: t.subjectId } : null; },
      conditional: (tx, exp) => this.repo.updateTrackConditional(tx, id, exp, data),
      reload: async (tx) => presentTrack((await this.repo.findTrack(id, tx))!),
    });
  }

  // ── Level (parent = Track via route :trackId) ──
  async createLevel(userId: string, trackId: string, dto: CreateLevelDto) {
    const track = await this.repo.findTrack(trackId);
    await this.scope.requireScope(userId, track ? track.subjectId : null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const level = await this.repo.createLevel(tx, { trackId, code: dto.code, title: dto.title, sortOrder: dto.sortOrder, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LEVEL_CREATE, targetType: CONTENT_TARGET.LEVEL, targetId: level.id, metadata: { trackId, code: level.code } });
        return presentLevel(level);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }
  async listLevels(userId: string, trackId: string) {
    const track = await this.repo.findTrack(trackId);
    await this.scope.requireScope(userId, track ? track.subjectId : null);
    return (await this.repo.listLevels(trackId)).map(presentLevel);
  }
  async getLevel(userId: string, id: string) {
    const l = await this.repo.findLevelScoped(id);
    if (!l) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, l.subjectId);
    return presentLevel(l);
  }
  async updateLevel(userId: string, id: string, dto: UpdateLevelDto) {
    const data: Prisma.LevelUpdateManyMutationInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.runPatch({
      userId, id, expectedUpdatedAt: dto.expectedUpdatedAt, fields: Object.keys(data),
      actionCode: CONTENT_AUDIT.LEVEL_UPDATE, targetType: CONTENT_TARGET.LEVEL,
      load: async (tx) => { const l = await this.repo.findLevelScoped(id, tx); return l ? { status: l.status, subjectId: l.subjectId } : null; },
      conditional: (tx, exp) => this.repo.updateLevelConditional(tx, id, exp, data),
      reload: async (tx) => presentLevel((await this.repo.findLevelScoped(id, tx))!),
    });
  }

  // ── Module (parent = Level via route :levelId) ──
  async createModule(userId: string, levelId: string, dto: CreateModuleDto) {
    const level = await this.repo.findLevelScoped(levelId);
    await this.scope.requireScope(userId, level ? level.subjectId : null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const mod = await this.repo.createModule(tx, { levelId, title: dto.title, description: dto.description ?? null, sortOrder: dto.sortOrder, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.MODULE_CREATE, targetType: CONTENT_TARGET.MODULE, targetId: mod.id, metadata: { levelId } });
        return presentModule(mod);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }
  async listModules(userId: string, levelId: string) {
    const level = await this.repo.findLevelScoped(levelId);
    await this.scope.requireScope(userId, level ? level.subjectId : null);
    return (await this.repo.listModules(levelId)).map(presentModule);
  }
  async getModule(userId: string, id: string) {
    const m = await this.repo.findModuleScoped(id);
    if (!m) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, m.subjectId);
    return presentModule(m);
  }
  async updateModule(userId: string, id: string, dto: UpdateModuleDto) {
    const data: Prisma.ModuleUpdateManyMutationInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.runPatch({
      userId, id, expectedUpdatedAt: dto.expectedUpdatedAt, fields: Object.keys(data),
      actionCode: CONTENT_AUDIT.MODULE_UPDATE, targetType: CONTENT_TARGET.MODULE,
      load: async (tx) => { const m = await this.repo.findModuleScoped(id, tx); return m ? { status: m.status, subjectId: m.subjectId } : null; },
      conditional: (tx, exp) => this.repo.updateModuleConditional(tx, id, exp, data),
      reload: async (tx) => presentModule((await this.repo.findModuleScoped(id, tx))!),
    });
  }

  // ── Topic (parent = Module via route :moduleId) ──
  async createTopic(userId: string, moduleId: string, dto: CreateTopicDto) {
    const mod = await this.repo.findModuleScoped(moduleId);
    await this.scope.requireScope(userId, mod ? mod.subjectId : null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const topic = await this.repo.createTopic(tx, { moduleId, title: dto.title, description: dto.description ?? null, sortOrder: dto.sortOrder, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.TOPIC_CREATE, targetType: CONTENT_TARGET.TOPIC, targetId: topic.id, metadata: { moduleId } });
        return presentTopic(topic);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict');
      throw e;
    }
  }
  async listTopics(userId: string, moduleId: string) {
    const mod = await this.repo.findModuleScoped(moduleId);
    await this.scope.requireScope(userId, mod ? mod.subjectId : null);
    return (await this.repo.listTopics(moduleId)).map(presentTopic);
  }
  async getTopic(userId: string, id: string) {
    const t = await this.repo.findTopicScoped(id);
    if (!t) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, t.subjectId);
    return presentTopic(t);
  }
  async updateTopic(userId: string, id: string, dto: UpdateTopicDto) {
    const data: Prisma.TopicUpdateManyMutationInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.runPatch({
      userId, id, expectedUpdatedAt: dto.expectedUpdatedAt, fields: Object.keys(data),
      actionCode: CONTENT_AUDIT.TOPIC_UPDATE, targetType: CONTENT_TARGET.TOPIC,
      load: async (tx) => { const t = await this.repo.findTopicScoped(id, tx); return t ? { status: t.status, subjectId: t.subjectId } : null; },
      conditional: (tx, exp) => this.repo.updateTopicConditional(tx, id, exp, data),
      reload: async (tx) => presentTopic((await this.repo.findTopicScoped(id, tx))!),
    });
  }

  // ── Lesson (parent = Topic via route :topicId) ──
  async createLesson(userId: string, topicId: string, dto: CreateLessonDto) {
    const topic = await this.repo.findTopicScoped(topicId);
    await this.scope.requireScope(userId, topic ? topic.subjectId : null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lesson = await this.repo.createLesson(tx, { topicId, contentKey: dto.contentKey, slug: dto.slug ?? null, sortOrder: dto.sortOrder, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LESSON_CREATE, targetType: CONTENT_TARGET.LESSON, targetId: lesson.id, metadata: { topicId, contentKey: lesson.contentKey } });
        return presentLesson(lesson);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentUniqueConflictError('conflict'); // duplicate contentKey
      throw e;
    }
  }
  async listLessons(userId: string, topicId: string) {
    const topic = await this.repo.findTopicScoped(topicId);
    await this.scope.requireScope(userId, topic ? topic.subjectId : null);
    return (await this.repo.listLessons(topicId)).map(presentLesson);
  }
  async getLesson(userId: string, id: string) {
    const l = await this.repo.findLessonScoped(id);
    if (!l) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, l.subjectId);
    return presentLesson(l);
  }
  async updateLesson(userId: string, id: string, dto: UpdateLessonDto) {
    const data: Prisma.LessonUpdateManyMutationInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.runPatch({
      userId, id, expectedUpdatedAt: dto.expectedUpdatedAt, fields: Object.keys(data),
      actionCode: CONTENT_AUDIT.LESSON_UPDATE, targetType: CONTENT_TARGET.LESSON,
      load: async (tx) => { const l = await this.repo.findLessonScoped(id, tx); return l ? { status: l.status, subjectId: l.subjectId } : null; },
      conditional: (tx, exp) => this.repo.updateLessonConditional(tx, id, exp, data),
      reload: async (tx) => presentLesson((await this.repo.findLessonScoped(id, tx))!),
    });
  }

  /** DRAFT lesson → another Topic in the SAME Subject (§14). Cross-subject / out-of-scope destination → not found. */
  async moveLesson(userId: string, id: string, dto: MoveLessonDto) {
    const expected = new Date(dto.expectedUpdatedAt);
    return await this.prisma.$transaction(async (tx) => {
      const lesson = await this.repo.findLessonScoped(id, tx);
      if (!lesson) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, lesson.subjectId, tx);
      if (lesson.status !== LessonStatus.DRAFT) throw new ContentNotDraftError('not draft');
      const dest = await this.repo.findTopicScoped(dto.toTopicId, tx);
      // destination must exist and be in the SAME subject; cross-subject/out-of-scope → not found (IDOR-safe, §17)
      if (!dest || dest.subjectId !== lesson.subjectId) throw new ContentNotFoundError('not found');
      const res = await this.repo.moveLessonConditional(tx, id, expected, dto.toTopicId);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      const updated = await this.repo.findLessonScoped(id, tx);
      await this.audit.write(tx, { actorUserId: userId, actionCode: CONTENT_AUDIT.LESSON_MOVE, targetType: CONTENT_TARGET.LESSON, targetId: id, metadata: { fromTopicId: lesson.topicId, toTopicId: dto.toTopicId } });
      return presentLesson(updated!);
    });
  }
}
