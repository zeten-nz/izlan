import type { Lesson, Revision } from '../lib/api/types';

export function makeRevision(over: Partial<Revision> = {}): Revision {
  return {
    id: 'rev1',
    lessonId: 'les1',
    version: 1,
    title: 'Test versiya',
    description: null,
    estimatedDurationMin: null,
    status: 'DRAFT',
    createdBy: null,
    updatedBy: null,
    reviewedBy: null,
    publishedBy: null,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: 't0',
    ...over,
  };
}

export function makeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'les1',
    topicId: 'top1',
    contentKey: 'lesson-key',
    slug: null,
    status: 'DRAFT',
    sortOrder: 0,
    publishedRevisionId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: 'L0',
    ...over,
  };
}
