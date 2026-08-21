import { computeXpProgression, levelForXp, levelThreshold, XP_PROGRESSION_VERSION } from './xp-progression.engine';

describe('levelThreshold (xp-progression-v1)', () => {
  it('§3 cumulative threshold formula 50·(L-1)·L', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(levelThreshold)).toEqual([0, 100, 300, 600, 1000, 1500, 4500]);
  });
});

describe('levelForXp (§6 exact boundaries)', () => {
  it('§32/§33/§34 exact threshold immediately enters the new level', () => {
    expect([0, 99, 100, 299, 300, 599, 600].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });
  it('§35 higher formula levels', () => {
    expect([1000, 1500, 4500].map(levelForXp)).toEqual([5, 6, 10]);
  });
  it('negative / zero → level 1 floor', () => {
    expect([-1, -1000, 0].map(levelForXp)).toEqual([1, 1, 1]);
  });
  it('large safe integer is deterministic (no float boundary error)', () => {
    // threshold(6001) = 50*6000*6001 = 1,800,300,000 ; threshold(6002)=50*6001*6002=1,800,900,100
    expect(levelForXp(1_800_300_000)).toBe(6001);
    expect(levelForXp(1_800_300_000 - 1)).toBe(6000);
  });
});

describe('computeXpProgression (§9/§10)', () => {
  it('§30 zero XP → L1, 0/100, progress 0', () => {
    expect(computeXpProgression(0)).toMatchObject({ totalXp: 0, progressionXp: 0, currentLevel: 1, currentLevelStartXp: 0, nextLevelXp: 100, xpIntoLevel: 0, xpToNextLevel: 100, progressBp: 0, progressionVersion: XP_PROGRESSION_VERSION });
  });
  it('§31 total 10 → L1, into 10, toNext 90, progress 1000bp', () => {
    expect(computeXpProgression(10)).toMatchObject({ currentLevel: 1, xpIntoLevel: 10, xpToNextLevel: 90, progressBp: 1000 });
  });
  it('§69 total 50 → L1 5000bp', () => {
    expect(computeXpProgression(50).progressBp).toBe(5000);
  });
  it('§32 total 100 → L2 start100 next300 into0 toNext200 progress0', () => {
    expect(computeXpProgression(100)).toMatchObject({ currentLevel: 2, currentLevelStartXp: 100, nextLevelXp: 300, xpIntoLevel: 0, xpToNextLevel: 200, progressBp: 0 });
  });
  it('§69 total 200 at L2 → 5000bp; total 299 at L2 → 9950bp', () => {
    expect(computeXpProgression(200).progressBp).toBe(5000); // floor(100*10000/200)
    expect(computeXpProgression(299)).toMatchObject({ currentLevel: 2, progressBp: 9950 }); // floor(199*10000/200)
  });
  it('§7/§36 negative total → signed totalXp preserved, progression clamped to 0, L1', () => {
    expect(computeXpProgression(-50)).toMatchObject({ totalXp: -50, progressionXp: 0, currentLevel: 1, xpIntoLevel: 0, xpToNextLevel: 100, progressBp: 0 });
  });
});
