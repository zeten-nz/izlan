import { Injectable } from '@nestjs/common';
import { ContainerStatus, LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from './optimistic-concurrency';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Content hierarchy persistence (Phase 2.2A-1). Explicit typed methods per entity — no generic BaseRepository.
 * Scoped reads flatten the resolved `subjectId` from the parent chain so the service can enforce SubjectAssignment
 * (§6). Conditional updates carry `updatedAt` + `status: DRAFT` in the WHERE for optimistic concurrency (§16).
 */
@Injectable()
export class HierarchyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  // ── Track ──
  createTrack(tx: Prisma.TransactionClient, data: { subjectId: string; slug: string; title: string; description?: string | null; sortOrder: number; createdBy: string }) {
    return tx.track.create({ data, select: TRACK_SELECT });
  }
  async findTrack(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).track.findUnique({ where: { id }, select: TRACK_SELECT });
  }
  listTracks(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).track.findMany({ where: { subjectId }, select: TRACK_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }
  updateTrackConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.TrackUpdateManyMutationInput) {
    return tx.track.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── Level ──
  createLevel(tx: Prisma.TransactionClient, data: { trackId: string; code: string; title: string; sortOrder: number; createdBy: string }) {
    return tx.level.create({ data, select: LEVEL_SELECT });
  }
  async findLevelScoped(id: string, tx?: Prisma.TransactionClient) {
    const l = await this.db(tx).level.findUnique({ where: { id }, select: { ...LEVEL_SELECT, track: { select: { subjectId: true } } } });
    if (!l) return null;
    const { track, ...rest } = l;
    return { ...rest, subjectId: track.subjectId };
  }
  listLevels(trackId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).level.findMany({ where: { trackId }, select: LEVEL_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }
  updateLevelConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.LevelUpdateManyMutationInput) {
    return tx.level.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── Module ──
  createModule(tx: Prisma.TransactionClient, data: { levelId: string; title: string; description?: string | null; sortOrder: number; createdBy: string }) {
    return tx.module.create({ data, select: MODULE_SELECT });
  }
  async findModuleScoped(id: string, tx?: Prisma.TransactionClient) {
    const m = await this.db(tx).module.findUnique({ where: { id }, select: { ...MODULE_SELECT, level: { select: { track: { select: { subjectId: true } } } } } });
    if (!m) return null;
    const { level, ...rest } = m;
    return { ...rest, subjectId: level.track.subjectId };
  }
  listModules(levelId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).module.findMany({ where: { levelId }, select: MODULE_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }
  updateModuleConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.ModuleUpdateManyMutationInput) {
    return tx.module.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── Topic ──
  createTopic(tx: Prisma.TransactionClient, data: { moduleId: string; title: string; description?: string | null; sortOrder: number; createdBy: string }) {
    return tx.topic.create({ data, select: TOPIC_SELECT });
  }
  async findTopicScoped(id: string, tx?: Prisma.TransactionClient) {
    const t = await this.db(tx).topic.findUnique({ where: { id }, select: { ...TOPIC_SELECT, module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } });
    if (!t) return null;
    const { module, ...rest } = t;
    return { ...rest, subjectId: module.level.track.subjectId };
  }
  listTopics(moduleId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).topic.findMany({ where: { moduleId }, select: TOPIC_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }
  updateTopicConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.TopicUpdateManyMutationInput) {
    return tx.topic.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: ContainerStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  // ── Lesson ──
  createLesson(tx: Prisma.TransactionClient, data: { topicId: string; contentKey: string; slug?: string | null; sortOrder: number; createdBy: string }) {
    return tx.lesson.create({ data, select: LESSON_SELECT });
  }
  async findLessonScoped(id: string, tx?: Prisma.TransactionClient) {
    const l = await this.db(tx).lesson.findUnique({ where: { id }, select: { ...LESSON_SELECT, topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } } });
    if (!l) return null;
    const { topic, ...rest } = l;
    return { ...rest, subjectId: topic.module.level.track.subjectId };
  }
  listLessons(topicId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).lesson.findMany({ where: { topicId }, select: LESSON_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }
  updateLessonConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.LessonUpdateManyMutationInput) {
    return tx.lesson.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: LessonStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  /** DRAFT lesson topic move — conditional on updatedAt + DRAFT (scope + same-subject asserted in the service). */
  moveLessonConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, toTopicId: string) {
    return tx.lesson.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: LessonStatus.DRAFT }, data: { topicId: toTopicId, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
}

const TRACK_SELECT = { id: true, subjectId: true, slug: true, title: true, description: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.TrackSelect;
const LEVEL_SELECT = { id: true, trackId: true, code: true, title: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.LevelSelect;
const MODULE_SELECT = { id: true, levelId: true, title: true, description: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.ModuleSelect;
const TOPIC_SELECT = { id: true, moduleId: true, title: true, description: true, status: true, sortOrder: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.TopicSelect;
const LESSON_SELECT = { id: true, topicId: true, contentKey: true, slug: true, status: true, sortOrder: true, publishedRevisionId: true, createdBy: true, createdAt: true, updatedAt: true } satisfies Prisma.LessonSelect;
