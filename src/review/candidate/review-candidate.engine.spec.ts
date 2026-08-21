import { buildReviewCandidates } from './review-candidate.engine';
import { CandidateFacts, EncounteredVisibleLesson, Exposure, SkillMeta, SkillSignals } from './review-candidate.types';

const skill = (id: string, name = id, sortOrder = 0): SkillMeta => ({ id, name, sortOrder });
const lesson = (lessonId: string, o: Partial<EncounteredVisibleLesson> = {}): EncounteredVisibleLesson => ({
  lessonId,
  title: o.title ?? `Title-${lessonId}`,
  topicId: o.topicId ?? 'topic',
  exposure: o.exposure ?? 'IN_PROGRESS',
  levelSort: o.levelSort ?? 0,
  moduleSort: o.moduleSort ?? 0,
  topicSort: o.topicSort ?? 0,
  lessonSort: o.lessonSort ?? 0,
});
const facts = (o: Partial<CandidateFacts> & { skills: SkillMeta[]; signals: SkillSignals[]; lessons?: EncounteredVisibleLesson[] }): CandidateFacts => ({
  skills: o.skills,
  signalsBySkill: new Map(o.signals.map((s) => [s.skillId, s])),
  visibleLessons: new Map((o.lessons ?? []).map((l) => [l.lessonId, l])),
  lessonSkill: o.lessonSkill ?? new Set(),
  activitySkillCurrent: o.activitySkillCurrent ?? new Set(),
});
const sig = (skillId: string, signalTypes: string[], directTriggerLessonIds: string[] = []): SkillSignals => ({ skillId, signalTypes, directTriggerLessonIds });

describe('buildReviewCandidates (review-candidate-v1)', () => {
  it('§48 no signals → empty', () => {
    expect(buildReviewCandidates(facts({ skills: [], signals: [] }))).toEqual({ groups: [], uncoveredSkillIds: [] });
  });

  it('§53 LessonSkill mapping → candidate', () => {
    const r = buildReviewCandidates(facts({ skills: [skill('g', 'Grammar')], signals: [sig('g', ['WEAK_SKILL'])], lessons: [lesson('A')], lessonSkill: new Set(['g::A']) }));
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ skill: { id: 'g', name: 'Grammar' }, signalTypes: ['WEAK_SKILL'] });
    expect(r.groups[0].candidates).toEqual([{ lesson: { id: 'A', title: 'Title-A', topicId: 'topic' }, exposure: 'IN_PROGRESS', directTrigger: false }]);
  });

  it('§54 current-revision ActivitySkill mapping → candidate', () => {
    const r = buildReviewCandidates(facts({ skills: [skill('g')], signals: [sig('g', ['REVIEW_DUE'])], lessons: [lesson('A', { exposure: 'COMPLETED' })], activitySkillCurrent: new Set(['g::A']) }));
    expect(r.groups[0].candidates).toEqual([{ lesson: { id: 'A', title: 'Title-A', topicId: 'topic' }, exposure: 'COMPLETED', directTrigger: false }]);
  });

  it('§55 no explicit mapping (only a visible lesson) → not a candidate → uncovered', () => {
    const r = buildReviewCandidates(facts({ skills: [skill('g')], signals: [sig('g', ['WEAK_SKILL'])], lessons: [lesson('A')] }));
    expect(r.groups).toEqual([]);
    expect(r.uncoveredSkillIds).toEqual(['g']);
  });

  it('§56/§57 direct trigger → candidate directTrigger=true (even without current mapping)', () => {
    const r = buildReviewCandidates(facts({ skills: [skill('g')], signals: [sig('g', ['REPEATED_MISTAKE'], ['A'])], lessons: [lesson('A')] }));
    expect(r.groups[0].candidates).toEqual([{ lesson: { id: 'A', title: 'Title-A', topicId: 'topic' }, exposure: 'IN_PROGRESS', directTrigger: true }]);
  });

  it('direct-trigger lesson not visible/encountered → dropped', () => {
    const r = buildReviewCandidates(facts({ skills: [skill('g')], signals: [sig('g', ['REPEATED_MISTAKE'], ['ARCHIVED'])], lessons: [] }));
    expect(r.groups).toEqual([]);
    expect(r.uncoveredSkillIds).toEqual(['g']);
  });

  it('§60/§61 multiple signals + multiple mappings on same lesson → one group, one candidate, canonical signalTypes', () => {
    const r = buildReviewCandidates(
      facts({ skills: [skill('g')], signals: [sig('g', ['WEAK_SKILL', 'REPEATED_MISTAKE', 'REVIEW_DUE'], ['A'])], lessons: [lesson('A')], lessonSkill: new Set(['g::A']), activitySkillCurrent: new Set(['g::A']) }),
    );
    expect(r.groups[0].signalTypes).toEqual(['REPEATED_MISTAKE', 'REVIEW_DUE', 'WEAK_SKILL']); // §21 order
    expect(r.groups[0].candidates).toHaveLength(1);
    expect(r.groups[0].candidates[0].directTrigger).toBe(true);
  });

  it('§62/§38 multiple skills → separate groups ordered by sortOrder,name,id', () => {
    const r = buildReviewCandidates(
      facts({
        skills: [skill('v', 'Vocabulary', 1), skill('g', 'Grammar', 0)],
        signals: [sig('g', ['WEAK_SKILL']), sig('v', ['REVIEW_DUE'])],
        lessons: [lesson('A'), lesson('B')],
        lessonSkill: new Set(['g::A', 'v::B']),
      }),
    );
    expect(r.groups.map((x) => x.skill.id)).toEqual(['g', 'v']);
    expect(r.groups[0].candidates.map((c) => c.lesson.id)).toEqual(['A']);
    expect(r.groups[1].candidates.map((c) => c.lesson.id)).toEqual(['B']);
  });

  it('§24/§71 deterministic order: direct-trigger first, then hierarchy, then id', () => {
    const r = buildReviewCandidates(
      facts({
        skills: [skill('g')],
        signals: [sig('g', ['REPEATED_MISTAKE', 'WEAK_SKILL'], ['C'])],
        lessons: [
          lesson('A', { levelSort: 0, lessonSort: 2 }),
          lesson('B', { levelSort: 0, lessonSort: 1 }),
          lesson('C', { levelSort: 5, lessonSort: 9 }), // hierarchy-late but direct-trigger → first
        ],
        lessonSkill: new Set(['g::A', 'g::B', 'g::C']),
      }),
    );
    expect(r.groups[0].candidates.map((c) => c.lesson.id)).toEqual(['C', 'B', 'A']);
    expect(r.groups[0].candidates[0].directTrigger).toBe(true);
  });

  it('§72 no cap: all eligible candidates returned', () => {
    const ids = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
    const r = buildReviewCandidates(facts({ skills: [skill('g')], signals: [sig('g', ['WEAK_SKILL'])], lessons: ids.map((id, i) => lesson(id, { lessonSort: i })), lessonSkill: new Set(ids.map((id) => `g::${id}`)) }));
    expect(r.groups[0].candidates.map((c) => c.lesson.id)).toEqual(ids);
  });
});
