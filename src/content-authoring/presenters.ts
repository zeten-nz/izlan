import { ContainerStatus, LessonStatus } from '@prisma/client';

/**
 * Staff read projections (Phase 2.2A-1, §20). Dates are emitted as ISO-8601 strings so `updatedAt` round-trips
 * exactly as the `expectedUpdatedAt` concurrency token. No learner progress; no unrelated user/auth data.
 */
const iso = (d: Date): string => d.toISOString();

export const presentSubject = (s: {
  id: string; slug: string; title: string; description: string | null; status: ContainerStatus; sortOrder: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: s.id, slug: s.slug, title: s.title, description: s.description, status: s.status, sortOrder: s.sortOrder, createdBy: s.createdBy, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt) });

export const presentAssignment = (a: {
  id: string; userId: string; subjectId: string; assignedAt: Date; assignedBy: string | null;
}) => ({ id: a.id, userId: a.userId, subjectId: a.subjectId, assignedAt: iso(a.assignedAt), assignedBy: a.assignedBy });

export const presentTrack = (t: {
  id: string; subjectId: string; slug: string; title: string; description: string | null; status: ContainerStatus; sortOrder: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: t.id, subjectId: t.subjectId, slug: t.slug, title: t.title, description: t.description, status: t.status, sortOrder: t.sortOrder, createdBy: t.createdBy, createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt) });

export const presentLevel = (l: {
  id: string; trackId: string; code: string; title: string; status: ContainerStatus; sortOrder: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: l.id, trackId: l.trackId, code: l.code, title: l.title, status: l.status, sortOrder: l.sortOrder, createdBy: l.createdBy, createdAt: iso(l.createdAt), updatedAt: iso(l.updatedAt) });

export const presentModule = (m: {
  id: string; levelId: string; title: string; description: string | null; status: ContainerStatus; sortOrder: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: m.id, levelId: m.levelId, title: m.title, description: m.description, status: m.status, sortOrder: m.sortOrder, createdBy: m.createdBy, createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt) });

export const presentTopic = (t: {
  id: string; moduleId: string; title: string; description: string | null; status: ContainerStatus; sortOrder: number; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: t.id, moduleId: t.moduleId, title: t.title, description: t.description, status: t.status, sortOrder: t.sortOrder, createdBy: t.createdBy, createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt) });

export const presentLesson = (l: {
  id: string; topicId: string; contentKey: string; slug: string | null; status: LessonStatus; sortOrder: number; publishedRevisionId: string | null; createdBy: string; createdAt: Date; updatedAt: Date;
}) => ({ id: l.id, topicId: l.topicId, contentKey: l.contentKey, slug: l.slug, status: l.status, sortOrder: l.sortOrder, publishedRevisionId: l.publishedRevisionId, createdBy: l.createdBy, createdAt: iso(l.createdAt), updatedAt: iso(l.updatedAt) });
