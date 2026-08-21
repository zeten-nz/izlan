import { deriveLessonMastery } from './lesson-mastery.engine';

describe('deriveLessonMastery (lesson-mastery-v1)', () => {
  it('§54 per-skill mean of best scores; evidenceCount = distinct mastery activities', () => {
    const out = deriveLessonMastery([
      { activityId: 'A', bestScoreBp: 8000, skillIds: ['g'] },
      { activityId: 'B', bestScoreBp: 10000, skillIds: ['g'] },
    ]);
    expect(out).toEqual([{ skillId: 'g', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 2 }]);
  });

  it('§55/28 attribution: each activity contributes to its own Skill only (no cross-skill copy)', () => {
    const out = deriveLessonMastery([
      { activityId: 'A', bestScoreBp: 8000, skillIds: ['g'] },
      { activityId: 'B', bestScoreBp: 6000, skillIds: ['v'] },
    ]);
    expect(out).toEqual([
      { skillId: 'g', scoreBp: 8000, confidenceBp: 10000, evidenceCount: 1 },
      { skillId: 'v', scoreBp: 6000, confidenceBp: 10000, evidenceCount: 1 },
    ]);
  });

  it('§26 one activity mapped to multiple Skills contributes its best to each', () => {
    const out = deriveLessonMastery([{ activityId: 'A', bestScoreBp: 7000, skillIds: ['g', 'v'] }]);
    expect(out).toEqual([
      { skillId: 'g', scoreBp: 7000, confidenceBp: 10000, evidenceCount: 1 },
      { skillId: 'v', scoreBp: 7000, confidenceBp: 10000, evidenceCount: 1 },
    ]);
  });

  it('confidence is always 10000; rounds mean; clamps 0..10000', () => {
    const out = deriveLessonMastery([
      { activityId: 'A', bestScoreBp: 5000, skillIds: ['g'] },
      { activityId: 'B', bestScoreBp: 5001, skillIds: ['g'] },
    ]);
    expect(out[0]).toMatchObject({ scoreBp: 5001, confidenceBp: 10000 }); // round((5000+5001)/2)=5001 (round-half-up)
  });

  it('no inputs → no measurement', () => {
    expect(deriveLessonMastery([])).toEqual([]);
  });
});
