import { ContainerStatus, LessonStatus, RevisionStatus } from '@prisma/client';
import { LessonVisibilityRow, isHierarchyPublished, isLessonCurrentlyVisible } from './learner-content-visibility';

const PUB = ContainerStatus.PUBLISHED;
const row = (over: Partial<LessonVisibilityRow> & { hierarchy?: ContainerStatus }): LessonVisibilityRow => {
  const h = over.hierarchy ?? PUB;
  return {
    id: 'L1',
    status: LessonStatus.PUBLISHED,
    publishedRevisionId: 'R1',
    topic: { status: h, module: { status: h, level: { status: h, track: { status: h, subject: { status: h } } } } },
    publishedRevision: { id: 'R1', status: RevisionStatus.PUBLISHED, lessonId: 'L1' },
    ...over,
  };
};

describe('learner content visibility (canonical authority, TD-250)', () => {
  it('VIS-08 full coherent hierarchy → visible', () => {
    expect(isLessonCurrentlyVisible(row({}))).toBe(true);
  });
  it('VIS-01 Subject not PUBLISHED → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ topic: { status: PUB, module: { status: PUB, level: { status: PUB, track: { status: PUB, subject: { status: ContainerStatus.DRAFT } } } } } }))).toBe(false);
  });
  it('VIS-02 Track not PUBLISHED → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ topic: { status: PUB, module: { status: PUB, level: { status: PUB, track: { status: ContainerStatus.DRAFT, subject: { status: PUB } } } } } }))).toBe(false);
  });
  it('VIS-03 Level/Module/Topic not PUBLISHED → not visible', () => {
    const D = ContainerStatus.DRAFT;
    const topic = (t: ContainerStatus, m: ContainerStatus, lv: ContainerStatus): LessonVisibilityRow['topic'] => ({ status: t, module: { status: m, level: { status: lv, track: { status: PUB, subject: { status: PUB } } } } });
    expect(isLessonCurrentlyVisible(row({ topic: topic(D, PUB, PUB) }))).toBe(false);
    expect(isLessonCurrentlyVisible(row({ topic: topic(PUB, D, PUB) }))).toBe(false);
    expect(isLessonCurrentlyVisible(row({ topic: topic(PUB, PUB, D) }))).toBe(false);
  });
  it('VIS-04 Lesson not PUBLISHED → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ status: LessonStatus.ARCHIVED }))).toBe(false);
    expect(isLessonCurrentlyVisible(row({ status: LessonStatus.DRAFT }))).toBe(false);
  });
  it('VIS-05 publishedRevisionId null → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ publishedRevisionId: null, publishedRevision: null }))).toBe(false);
  });
  it('VIS-06 pointed revision not PUBLISHED → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ publishedRevision: { id: 'R1', status: RevisionStatus.ARCHIVED, lessonId: 'L1' } }))).toBe(false);
  });
  it('VIS-07 pointer references a revision of another Lesson → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ publishedRevision: { id: 'R1', status: RevisionStatus.PUBLISHED, lessonId: 'OTHER' } }))).toBe(false);
  });
  it('pointer id mismatch → not visible', () => {
    expect(isLessonCurrentlyVisible(row({ publishedRevisionId: 'R1', publishedRevision: { id: 'R2', status: RevisionStatus.PUBLISHED, lessonId: 'L1' } }))).toBe(false);
  });
  it('isHierarchyPublished ignores revision pointer (resume gate)', () => {
    expect(isHierarchyPublished(row({ publishedRevisionId: null, publishedRevision: null }))).toBe(true);
    expect(isHierarchyPublished(row({ hierarchy: ContainerStatus.DRAFT }))).toBe(false);
  });
});
