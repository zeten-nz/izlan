import { SkillMeasurementSource } from '@prisma/client';
import { LearningProgressConfigurationInvalidError, LearningProgressNoEffectiveEvidenceError } from '../../common/errors';
import { mergeSkill, NormalizedMeasurement } from './learning-progress-merge.engine';

let seq = 0;
function m(source: SkillMeasurementSource, scoreBp: number, confidenceBp: number, evidenceCount: number, t: number, id?: string): NormalizedMeasurement {
  return { id: id ?? `m${seq++}`, source, scoreBp, confidenceBp, evidenceCount, observedAt: new Date(t) };
}
const D = SkillMeasurementSource.DIAGNOSTIC;
const C = SkillMeasurementSource.CHECKPOINT;
const L = SkillMeasurementSource.LESSON_MASTERY;

describe('mergeSkill (learning-progress-merge-v1)', () => {
  beforeEach(() => (seq = 0));

  it('§41 diagnostic-only reproduces the diagnostic milestone exactly (1.5C parity)', () => {
    const r = mergeSkill([m(D, 6000, 10000, 4, 1000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 6000, confidenceBp: 10000, evidenceCount: 4 });
    expect(r.lastMeasurementAt.getTime()).toBe(1000);
    expect(r.displayLevel).toBeNull();
  });

  it('§42 diagnostic + one lesson: one lesson does not replace the whole diagnostic', () => {
    const r = mergeSkill([m(D, 6000, 10000, 4, 1000), m(L, 9000, 10000, 1, 2000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 6600, confidenceBp: 10000, evidenceCount: 5 });
    expect(r.lastMeasurementAt.getTime()).toBe(2000);
  });

  it('§43 low-confidence baseline adapts faster; confidence = evidence-count weighted mean', () => {
    const r = mergeSkill([m(D, 6000, 5000, 2, 1000), m(L, 9000, 10000, 1, 2000)])!;
    expect(r.masteryScoreBp).toBe(7500); // (6000·2·5000 + 9000·1·10000)/(2·5000 + 1·10000)
    expect(r.confidenceBp).toBe(6667); // round((5000·2 + 10000·1)/3)
    expect(r.evidenceCount).toBe(3);
  });

  it('§44 multiple lesson milestones accumulate', () => {
    const r = mergeSkill([m(D, 6000, 10000, 4, 1000), m(L, 8000, 10000, 1, 2000), m(L, 10000, 10000, 2, 3000)])!;
    expect(r.masteryScoreBp).toBe(7429); // round((6000·4 + 8000·1 + 10000·2)/7) = round(52000/7)
    expect(r.confidenceBp).toBe(10000);
    expect(r.evidenceCount).toBe(7);
  });

  it('§45 CHECKPOINT resets the current window; older diagnostic + older lesson excluded (history kept)', () => {
    const diag = m(D, 6000, 10000, 4, 1000);
    const oldLesson = m(L, 9000, 10000, 1, 2000);
    const checkpoint = m(C, 8000, 10000, 5, 3000);
    const newLesson = m(L, 10000, 10000, 1, 4000);
    const r = mergeSkill([diag, oldLesson, checkpoint, newLesson])!;
    expect(r.masteryScoreBp).toBe(8333); // round((8000·5 + 10000·1)/6)
    expect(r.evidenceCount).toBe(6);
    expect(r.anchorMeasurementId).toBe(checkpoint.id);
    expect(r.includedMeasurementIds.sort()).toEqual([checkpoint.id, newLesson.id].sort());
  });

  it('§46 latest DIAGNOSTIC becomes the anchor; earlier diagnostic + its lesson excluded', () => {
    const d1 = m(D, 4000, 10000, 3, 1000);
    const a = m(L, 7000, 10000, 1, 1500);
    const d2 = m(D, 6000, 10000, 4, 2000);
    const b = m(L, 9000, 10000, 1, 2500);
    const r = mergeSkill([d1, a, d2, b])!;
    expect(r.anchorMeasurementId).toBe(d2.id);
    expect(r.includedMeasurementIds.sort()).toEqual([d2.id, b.id].sort());
    expect(r.masteryScoreBp).toBe(6600); // (6000·4 + 9000·1)/5
  });

  it('§47 no anchor → merge all lesson measurements (no fabricated diagnostic)', () => {
    const r = mergeSkill([m(L, 8000, 10000, 1, 1000), m(L, 10000, 10000, 1, 2000)])!;
    expect(r.anchorMeasurementId).toBeNull();
    expect(r.masteryScoreBp).toBe(9000);
    expect(r.evidenceCount).toBe(2);
  });

  it('§48 equal anchor timestamp → CHECKPOINT wins over DIAGNOSTIC (deterministic, order-independent)', () => {
    const diag = m(D, 6000, 10000, 4, 5000, 'd');
    const chk = m(C, 8000, 10000, 2, 5000, 'c');
    expect(mergeSkill([diag, chk])!.anchorMeasurementId).toBe('c');
    expect(mergeSkill([chk, diag])!.anchorMeasurementId).toBe('c');
  });

  it('unsupported sources (AI_EVALUATION / ENGINE_RECALC) never affect current state', () => {
    const r = mergeSkill([m(D, 6000, 10000, 4, 1000), m(SkillMeasurementSource.AI_EVALUATION, 10000, 10000, 9, 5000), m(SkillMeasurementSource.ENGINE_RECALC, 0, 10000, 9, 6000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 6000, evidenceCount: 4 });
  });

  it('no supported measurements → null (caller must not write/delete state)', () => {
    expect(mergeSkill([])).toBeNull();
    expect(mergeSkill([m(SkillMeasurementSource.AI_EVALUATION, 5000, 10000, 1, 1000)])).toBeNull();
  });

  it('canonical rounding is round-half-up at the exact midpoint', () => {
    const r = mergeSkill([m(L, 5000, 1, 1, 1000), m(L, 5001, 1, 1, 2000)])!;
    expect(r.masteryScoreBp).toBe(5001); // 10001/2 = 5000.5 → 5001
  });

  it('§38/39 malformed evidenceCount → configuration invalid; all-zero confidence → no effective evidence', () => {
    expect(() => mergeSkill([m(D, 6000, 10000, 0, 1000)])).toThrow(LearningProgressConfigurationInvalidError);
    expect(() => mergeSkill([m(D, 6000, 0, 3, 1000)])).toThrow(LearningProgressNoEffectiveEvidenceError);
  });

  it('equal-time lesson vs anchor: anchor wins the tie (lesson excluded)', () => {
    const diag = m(D, 6000, 10000, 4, 2000);
    const lessonSameTime = m(L, 10000, 10000, 1, 2000);
    const r = mergeSkill([diag, lessonSameTime])!;
    expect(r.includedMeasurementIds).toEqual([diag.id]);
    expect(r.masteryScoreBp).toBe(6000);
  });
});
