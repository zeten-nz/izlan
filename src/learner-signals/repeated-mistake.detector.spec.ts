import { collapseLatestPerActivity, detectRepeatedMistake } from './repeated-mistake.detector';

const o = (activityId: string, isCorrect: boolean) => ({ activityId, activityAttemptId: `${activityId}-att`, isCorrect });

describe('detectRepeatedMistake (repeated-mistake-signal-v1)', () => {
  it('§43 two distinct wrong → NO_CHANGE (needs 3)', () => {
    expect(detectRepeatedMistake([o('A', false), o('B', false)], false)).toEqual({ action: 'NO_CHANGE' });
  });

  it('§44 three most-recent distinct wrong → ACTIVATE (carries the 3 trigger ids)', () => {
    const d = detectRepeatedMistake([o('C', false), o('B', false), o('A', false)], false);
    expect(d).toMatchObject({ action: 'ACTIVATE', triggerActivityIds: ['C', 'B', 'A'], triggerAttemptIds: ['C-att', 'B-att', 'A-att'] });
  });

  it('§47 mixed most-recent-3 → NO_CHANGE', () => {
    expect(detectRepeatedMistake([o('C', true), o('B', false), o('A', false)], false)).toEqual({ action: 'NO_CHANGE' });
  });

  it('trigger uses only the 3 MOST RECENT distinct outcomes (a recent correct blocks it)', () => {
    // most-recent-first: correct, wrong, wrong, wrong → first 3 = [correct, wrong, wrong] → no trigger
    expect(detectRepeatedMistake([o('D', true), o('C', false), o('B', false), o('A', false)], false)).toEqual({ action: 'NO_CHANGE' });
  });

  it('§48 active + one correct → still ACTIVE (NO_CHANGE)', () => {
    expect(detectRepeatedMistake([o('D', true)], true)).toEqual({ action: 'NO_CHANGE' });
  });

  it('§49 active + two most-recent distinct correct → RESOLVE', () => {
    expect(detectRepeatedMistake([o('E', true), o('D', true), o('A', false)], true)).toEqual({ action: 'RESOLVE' });
  });

  it('active + recent wrong within the last two → stays ACTIVE', () => {
    expect(detectRepeatedMistake([o('E', true), o('D', false)], true)).toEqual({ action: 'NO_CHANGE' });
  });

  it('ACTIVATE only fires with no active signal; RESOLVE only fires with an active signal', () => {
    expect(detectRepeatedMistake([o('C', false), o('B', false), o('A', false)], true)).toEqual({ action: 'NO_CHANGE' }); // already active
    expect(detectRepeatedMistake([o('E', true), o('D', true)], false)).toEqual({ action: 'NO_CHANGE' }); // not active
  });
});

describe('collapseLatestPerActivity (§10 distinct-Activity collapse)', () => {
  it('§45 same-Activity retries collapse to one latest outcome', () => {
    // most-recent-first: A(correct latest), A(wrong), A(wrong)
    const out = collapseLatestPerActivity([o('A', true), o('A', false), o('A', false)]);
    expect(out).toEqual([{ activityId: 'A', activityAttemptId: 'A-att', isCorrect: true }]);
  });

  it('§46 latest outcome per Activity wins; distinct order preserved', () => {
    // most-recent-first: A correct (latest), C wrong, B wrong, A wrong (older) → [A correct, C wrong, B wrong]
    const out = collapseLatestPerActivity([o('A', true), o('C', false), o('B', false), o('A', false)]);
    expect(out.map((x) => x.activityId)).toEqual(['A', 'C', 'B']);
    expect(detectRepeatedMistake(out, false)).toEqual({ action: 'NO_CHANGE' }); // A is correct → no trigger
  });
});
