import { detectWeakSkill } from './weak-skill-signal.policy';

const st = (masteryScoreBp: number, confidenceBp: number, evidenceCount: number) => ({ masteryScoreBp, confidenceBp, evidenceCount });

describe('detectWeakSkill (weak-skill-signal-v1)', () => {
  it('§37 activation: mastery<5000 + conf>=7000 + evidence>=3', () => {
    expect(detectWeakSkill(st(4999, 7000, 3), false)).toBe('ACTIVATE');
  });

  it('§38 confidence gate: below 7000 → no activation even at very low mastery', () => {
    expect(detectWeakSkill(st(2000, 6999, 10), false)).toBe('NO_CHANGE');
  });

  it('§39 evidence gate: fewer than 3 units → no activation', () => {
    expect(detectWeakSkill(st(2000, 10000, 2), false)).toBe('NO_CHANGE');
  });

  it('§40 exact threshold: mastery == 5000 does NOT activate (strictly < 5000)', () => {
    expect(detectWeakSkill(st(5000, 10000, 10), false)).toBe('NO_CHANGE');
  });

  it('§41 hysteresis hold band: active signal at mastery 6000 stays ACTIVE (5000..6499 neutral)', () => {
    expect(detectWeakSkill(st(6000, 10000, 10), true)).toBe('NO_CHANGE');
    expect(detectWeakSkill(st(6499, 10000, 10), true)).toBe('NO_CHANGE');
    expect(detectWeakSkill(st(5800, 10000, 3), false)).toBe('NO_CHANGE'); // no active, band → no create
  });

  it('§42 resolution: mastery>=6500 + conf>=7000 → RESOLVE', () => {
    expect(detectWeakSkill(st(6500, 7000, 3), true)).toBe('RESOLVE');
  });

  it('§43 resolve requires confidence: 9000 mastery but conf 6999 → stays ACTIVE', () => {
    expect(detectWeakSkill(st(9000, 6999, 3), true)).toBe('NO_CHANGE');
  });

  it('§10 confidence drop while active never resolves', () => {
    expect(detectWeakSkill(st(4000, 2000, 3), true)).toBe('NO_CHANGE');
  });

  it('null state → NO_CHANGE (cannot activate; active simply holds)', () => {
    expect(detectWeakSkill(null, false)).toBe('NO_CHANGE');
    expect(detectWeakSkill(null, true)).toBe('NO_CHANGE');
  });
});
