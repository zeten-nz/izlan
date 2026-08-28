import type { V2RoadmapPointView } from '../learning-core/v2-roadmap.service';
import { attentionItems, deriveTodayAction, selectMainPoint } from './daily-learning.policy';

const pt = (over: Partial<V2RoadmapPointView>): V2RoadmapPointView => ({
  roadmapPointId: over.roadmapPointId ?? 'p',
  pointKey: over.pointKey ?? 'K',
  title: over.title ?? 'T',
  learningOutcome: null,
  estimatedEffortMin: 20,
  sortOrder: over.sortOrder ?? 1,
  availability: over.availability ?? 'AVAILABLE',
  acquisition: over.acquisition ?? null,
  attention: over.attention ?? 'NONE',
  attentionReason: over.attentionReason ?? null,
  attentionSkill: over.attentionSkill ?? null,
  learned: over.learned ?? false,
  validated: over.validated ?? false,
  activeSessionId: over.activeSessionId ?? null,
});

describe('Daily Learning policy (daily-learning-v1)', () => {
  it('selectMainPoint = the first AVAILABLE/IN_PROGRESS not-yet-acquired point', () => {
    const points = [pt({ roadmapPointId: 'a', learned: true, availability: 'AVAILABLE' }), pt({ roadmapPointId: 'b', availability: 'AVAILABLE' }), pt({ roadmapPointId: 'c', availability: 'LOCKED' })];
    expect(selectMainPoint(points)?.roadmapPointId).toBe('b');
  });

  it('returns DONE when there is no available new point', () => {
    const points = [pt({ roadmapPointId: 'a', learned: true }), pt({ roadmapPointId: 'c', availability: 'LOCKED' })];
    expect(selectMainPoint(points)).toBeNull();
    expect(deriveTodayAction(points, null).type).toBe('DONE');
  });

  it('LEARN the pinned main point when it is not yet acquired', () => {
    const points = [pt({ roadmapPointId: 'b', availability: 'AVAILABLE' })];
    const a = deriveTodayAction(points, 'b');
    expect(a.type).toBe('LEARN');
    expect(a.point?.roadmapPointId).toBe('b');
  });

  it('one-new-point-per-day: once the pinned main point is acquired, it does NOT advance to the next new point', () => {
    // main point 'b' is now LEARNED; 'c' is a new available point — but the day must not pick it.
    const points = [pt({ roadmapPointId: 'b', learned: true, availability: 'AVAILABLE' }), pt({ roadmapPointId: 'c', availability: 'AVAILABLE' })];
    expect(deriveTodayAction(points, 'b').type).toBe('DONE');
  });

  it('repair outranks review and new learning (acquired point needing repair)', () => {
    const points = [
      pt({ roadmapPointId: 'main', availability: 'AVAILABLE' }), // new learning available
      pt({ roadmapPointId: 'rev', learned: true, attention: 'REVIEW_DUE', attentionReason: 'RETENTION_DUE', attentionSkill: { id: 's1', name: 'S1' } }),
      pt({ roadmapPointId: 'rep', learned: true, attention: 'REPAIR_REQUIRED', attentionReason: 'REPEATED_MISTAKE', attentionSkill: { id: 's2', name: 'S2' } }),
    ];
    const a = deriveTodayAction(points, 'main');
    expect(a.type).toBe('REPAIR');
    expect(a.point?.roadmapPointId).toBe('rep');
    expect(a.skill?.id).toBe('s2');
  });

  it('review outranks new learning when there is no repair', () => {
    const points = [pt({ roadmapPointId: 'main', availability: 'AVAILABLE' }), pt({ roadmapPointId: 'rev', validated: true, attention: 'REVIEW_DUE', attentionSkill: { id: 's1', name: 'S1' } })];
    const a = deriveTodayAction(points, 'main');
    expect(a.type).toBe('REVIEW');
    expect(a.skill?.id).toBe('s1');
  });

  it('attentionItems surfaces only acquired points needing repair/review', () => {
    const points = [pt({ roadmapPointId: 'x', availability: 'AVAILABLE' }), pt({ roadmapPointId: 'y', learned: true, attention: 'REVIEW_DUE' }), pt({ roadmapPointId: 'z', learned: true, attention: 'NONE' })];
    expect(attentionItems(points).map((p) => p.roadmapPointId)).toEqual(['y']);
  });
});
