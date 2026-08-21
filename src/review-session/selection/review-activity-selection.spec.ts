import { selectReviewActivities, SelectionActivity } from './review-activity-selection';

const act = (activityId: string, position: number, attributedToTarget: boolean, hasAnyActivitySkill: boolean): SelectionActivity => ({ activityId, position, attributedToTarget, hasAnyActivitySkill });

describe('selectReviewActivities (review-session-v1)', () => {
  it('§68 ActivitySkill(target) selects; zero-ActivitySkill + LessonSkill fallback selects; other-skill excluded', () => {
    const activities = [
      act('A', 1, true, true), // ActivitySkill → target
      act('B', 2, false, true), // ActivitySkill → other skill only
      act('C', 3, false, false), // no ActivitySkill → LessonSkill fallback
    ];
    expect(selectReviewActivities(activities, true, [])).toEqual(['A', 'C']); // B excluded
  });

  it('§24 explicit attribution overrides fallback — an Activity with another ActivitySkill is never broadened', () => {
    const activities = [act('B', 1, false, true)]; // has ActivitySkill (other skill), lesson maps target
    expect(selectReviewActivities(activities, true, [])).toEqual([]); // fallback does NOT apply
  });

  it('no LessonSkill → zero-ActivitySkill Activity is not selected', () => {
    expect(selectReviewActivities([act('C', 1, false, false)], false, [])).toEqual([]);
  });

  it('§26 direct-trigger selected activities come first, then Activity.position, then id', () => {
    const activities = [act('A', 1, true, true), act('C', 2, false, false), act('B', 3, true, true)];
    expect(selectReviewActivities(activities, true, ['B'])).toEqual(['B', 'A', 'C']); // B direct-first; A/C by position
  });

  it('direct-trigger id that is not selected is ignored (no bypass of attribution)', () => {
    // X is a trigger id but not attributed and no fallback → not selected
    const activities = [act('A', 1, true, true), act('X', 2, false, true)];
    expect(selectReviewActivities(activities, true, ['X'])).toEqual(['A']);
  });

  it('empty selection → []', () => {
    expect(selectReviewActivities([], true, [])).toEqual([]);
    expect(selectReviewActivities([act('A', 1, false, true)], true, [])).toEqual([]);
  });
});
