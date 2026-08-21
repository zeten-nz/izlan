import { ActivityType } from '@prisma/client';
import { computeEligibility } from './lesson-completion-eligibility';

const act = (id: string, type: ActivityType) => ({ id, type });

describe('computeEligibility (lesson-completion-v1)', () => {
  it('§48 mixed lesson: eligible when every objective is submitted and every view-only is marked', () => {
    const activities = [act('t', ActivityType.TEXT), act('q', ActivityType.MINI_QUESTION), act('p', ActivityType.PRACTICE), act('m', ActivityType.MASTERY_TEST)];
    const r = computeEligibility(activities, new Set(['t']), new Set(['q', 'p', 'm']));
    expect(r).toMatchObject({ eligible: true, totalActivities: 4, completedActivities: 4, remainingActivityIds: [], unsupportedActivityIds: [] });
  });

  it('objective not submitted → remaining, not eligible (§6)', () => {
    const r = computeEligibility([act('q', ActivityType.MINI_QUESTION)], new Set(), new Set());
    expect(r.eligible).toBe(false);
    expect(r.remainingActivityIds).toEqual(['q']);
  });

  it('view-only not marked → remaining (§47)', () => {
    const r = computeEligibility([act('t', ActivityType.TEXT)], new Set(), new Set());
    expect(r.eligible).toBe(false);
    expect(r.remainingActivityIds).toEqual(['t']);
  });

  it('§50 unsupported type (WRITING/SPEAKING/LISTENING/AI/VIDEO) blocks completion', () => {
    for (const type of [ActivityType.WRITING, ActivityType.SPEAKING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO]) {
      const r = computeEligibility([act('x', type)], new Set(['x']), new Set(['x']));
      expect(r.eligible).toBe(false);
      expect(r.unsupportedActivityIds).toEqual(['x']);
    }
  });

  it('§51 zero activities → not eligible', () => {
    expect(computeEligibility([], new Set(), new Set())).toMatchObject({ eligible: false, totalActivities: 0 });
  });

  it('correctness never gates completion — a submitted objective counts as performed regardless of score', () => {
    // submitted set is derived from ActivityAttempt existence, not correctness (§12)
    const r = computeEligibility([act('m', ActivityType.MASTERY_TEST)], new Set(), new Set(['m']));
    expect(r.eligible).toBe(true);
  });
});
