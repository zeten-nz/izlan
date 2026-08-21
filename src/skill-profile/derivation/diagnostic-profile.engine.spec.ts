import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION, PlacementConfig, PoolItem } from '../../assessment/engine/placement-engine.types';
import { DiagnosticResponse } from './diagnostic-profile.types';
import { DiagnosticSkillProfileEngine, coverageConfidenceBp, normalizeMasteryBp } from './diagnostic-profile.engine';

function cfg(over: { itemsPerSkill?: number; min?: number; max?: number } = {}): PlacementConfig {
  return {
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION,
    engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 },
    coverage: { itemsPerSkill: over.itemsPerSkill ?? 4 },
    stopping: { maxItems: 20 },
    profileScale: { minDifficulty: over.min ?? 1, maxDifficulty: over.max ?? 6 },
  };
}
const item = (itemId: string, skillId: string, difficulty: number): PoolItem => ({ itemId, skillId, difficulty });
const r = (itemId: string, isCorrect: boolean): DiagnosticResponse => ({ itemId, isCorrect });

describe('DiagnosticSkillProfileEngine (skill-profile-diagnostic-v1)', () => {
  const engine = new DiagnosticSkillProfileEngine();

  describe('§44 mastery normalization', () => {
    it('estimatedDifficulty at min → 0, at max → 10000', () => {
      expect(normalizeMasteryBp(1, 1, 6)).toBe(0);
      expect(normalizeMasteryBp(6, 1, 6)).toBe(10000);
    });
    it('intermediate is deterministic', () => {
      expect(normalizeMasteryBp(2, 1, 6)).toBe(2000);
      expect(normalizeMasteryBp(3.5, 1, 6)).toBe(5000);
    });
    it('clamps below min → 0 and above max → 10000', () => {
      expect(normalizeMasteryBp(0.5, 1, 6)).toBe(0);
      expect(normalizeMasteryBp(9, 1, 6)).toBe(10000);
    });
    it('result is an integer', () => {
      expect(Number.isInteger(normalizeMasteryBp(2.7, 1, 6))).toBe(true);
    });
  });

  describe('§3/§13 FROZEN v1 evidence transform (correct→d, incorrect→d−1 ordinal, clamped, mean)', () => {
    const est = (pool: PoolItem[], responses: DiagnosticResponse[]) => engine.derive(cfg({ itemsPerSkill: 1 }), pool, responses)[0].estimatedDifficulty;
    it('correct at difficulty 4 → evidenceDifficulty 4', () => expect(est([item('x', 'g', 4)], [r('x', true)])).toBe(4));
    it('incorrect at difficulty 4 → evidenceDifficulty 3 (previous ordinal band)', () => expect(est([item('x', 'g', 4)], [r('x', false)])).toBe(3));
    it('incorrect at min difficulty 1 → clamped to 1', () => expect(est([item('x', 'g', 1)], [r('x', false)])).toBe(1));
    it('mean of evidence {2,4,6} → 4', () => expect(est([item('a', 'g', 2), item('b', 'g', 4), item('c', 'g', 6)], [r('a', true), r('b', true), r('c', true)])).toBe(4));
  });

  it('§45 difficulty matters: SAME accuracy, higher boundary → higher mastery (not percent-correct)', () => {
    // Profile A: correct at d2, incorrect at d3  (1/2 correct)
    const a = engine.derive(cfg(), [item('a1', 'g', 2), item('a2', 'g', 3)], [r('a1', true), r('a2', false)]);
    // Profile B: correct at d5, incorrect at d6  (1/2 correct — same accuracy)
    const b = engine.derive(cfg(), [item('b1', 'g', 5), item('b2', 'g', 6)], [r('b1', true), r('b2', false)]);
    expect(a[0].masteryScoreBp).toBe(2000); // mean estimate 2 → normalize(2,1,6)
    expect(b[0].masteryScoreBp).toBe(8000); // mean estimate 5 → normalize(5,1,6)
    expect(b[0].masteryScoreBp).toBeGreaterThan(a[0].masteryScoreBp);
  });

  it('§46 per-skill independence: one skill high boundary, another low → different mastery per skill', () => {
    const pool = [item('g1', 'g', 5), item('r1', 'r', 1)];
    const out = engine.derive(cfg({ itemsPerSkill: 1 }), pool, [r('g1', true), r('r1', true)]);
    const g = out.find((e) => e.skillId === 'g')!;
    const rr = out.find((e) => e.skillId === 'r')!;
    expect(g.masteryScoreBp).toBe(8000); // difficulty 5
    expect(rr.masteryScoreBp).toBe(0); // difficulty 1 (= min)
    expect(g.masteryScoreBp).not.toBe(rr.masteryScoreBp);
  });

  describe('§47 confidence = coverage', () => {
    it.each([
      [1, 2500],
      [2, 5000],
      [3, 7500],
      [4, 10000],
      [5, 10000], // capped at full
    ])('itemsPerSkill=4, evidence %i → %i bp', (evidence, expected) => {
      expect(coverageConfidenceBp(evidence, 4)).toBe(expected);
    });
  });

  it('§48 incomplete coverage: full-quota skill confidence 10000, half-quota skill 5000; both keep mastery', () => {
    const pool = [
      item('a1', 'A', 3), item('a2', 'A', 3), item('a3', 'A', 3), item('a4', 'A', 3),
      item('b1', 'B', 4), item('b2', 'B', 4),
    ];
    const responses = [r('a1', true), r('a2', true), r('a3', true), r('a4', true), r('b1', true), r('b2', true)];
    const out = engine.derive(cfg({ itemsPerSkill: 4 }), pool, responses);
    const a = out.find((e) => e.skillId === 'A')!;
    const b = out.find((e) => e.skillId === 'B')!;
    expect(a.confidenceBp).toBe(10000);
    expect(a.evidenceCount).toBe(4);
    expect(b.confidenceBp).toBe(5000); // 2/4
    expect(b.evidenceCount).toBe(2);
    expect(a.masteryScoreBp).toBeGreaterThan(0); // both measured, no fake zero
    expect(b.masteryScoreBp).toBeGreaterThan(0);
  });

  it('§49 zero evidence: a pool skill with no responses gets NO entry', () => {
    const pool = [item('a1', 'A', 3), item('c1', 'C', 3)]; // C never answered
    const out = engine.derive(cfg({ itemsPerSkill: 1 }), pool, [r('a1', true)]);
    expect(out.map((e) => e.skillId)).toEqual(['A']);
    expect(out.find((e) => e.skillId === 'C')).toBeUndefined();
  });

  it('deterministic order (skillId ascending) and ignores out-of-pool responses', () => {
    const pool = [item('z1', 'z', 3), item('a1', 'a', 3)];
    const out = engine.derive(cfg({ itemsPerSkill: 1 }), pool, [r('z1', true), r('a1', true), r('ghost', true)]);
    expect(out.map((e) => e.skillId)).toEqual(['a', 'z']);
  });
});
