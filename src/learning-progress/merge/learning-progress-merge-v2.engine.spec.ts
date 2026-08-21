import { SkillMeasurementSource } from '@prisma/client';
import { mergeSkill } from './learning-progress-merge.engine';
import { mergeSkillV2 } from './learning-progress-merge-v2.engine';
import { NormalizedMeasurement } from './merge-core';

let seq = 0;
const m = (source: SkillMeasurementSource, scoreBp: number, confidenceBp: number, evidenceCount: number, t: number, id?: string): NormalizedMeasurement => ({ id: id ?? `m${seq++}`, source, scoreBp, confidenceBp, evidenceCount, observedAt: new Date(t) });
const D = SkillMeasurementSource.DIAGNOSTIC;
const C = SkillMeasurementSource.CHECKPOINT;
const L = SkillMeasurementSource.LESSON_MASTERY;
const R = SkillMeasurementSource.REVIEW_MASTERY;

describe('mergeSkillV2 (learning-progress-merge-v2)', () => {
  beforeEach(() => (seq = 0));

  it('§58 review-only (no anchor) → review milestone becomes current state', () => {
    const r = mergeSkillV2([m(R, 8000, 10000, 3, 1000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 8000, confidenceBp: 10000, evidenceCount: 3 });
  });

  it('§59 diagnostic + review: review is incremental (does not reset the baseline)', () => {
    const r = mergeSkillV2([m(D, 6000, 10000, 4, 1000), m(R, 9000, 10000, 2, 2000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 7000, confidenceBp: 10000, evidenceCount: 6 }); // (6000·4 + 9000·2)/6
  });

  it('§60 diagnostic + lesson + review accumulate', () => {
    const r = mergeSkillV2([m(D, 6000, 10000, 4, 1000), m(L, 8000, 10000, 1, 2000), m(R, 10000, 10000, 2, 3000)])!;
    expect(r.masteryScoreBp).toBe(7429); // round((6000·4 + 8000·1 + 10000·2)/7)
    expect(r.evidenceCount).toBe(7);
  });

  it('§25/§36 review can LOWER current mastery (real evidence, not max)', () => {
    const r = mergeSkillV2([m(D, 7000, 10000, 1, 1000), m(R, 2000, 10000, 1, 2000)])!;
    expect(r.masteryScoreBp).toBe(4500); // (7000 + 2000)/2 — decreased
  });

  it('§20/§22 REVIEW_MASTERY is never an anchor (a later review does not reset the window)', () => {
    const diag = m(D, 6000, 10000, 4, 1000);
    const review = m(R, 9000, 10000, 2, 5000); // latest observedAt but NOT an anchor
    const r = mergeSkillV2([diag, review])!;
    expect(r.anchorMeasurementId).toBe(diag.id); // diagnostic remains the anchor
    expect(r.includedMeasurementIds.sort()).toEqual([diag.id, review.id].sort());
  });

  it('§26/§61 CHECKPOINT resets the window; older diagnostic + older review excluded (kept as history)', () => {
    const diag = m(D, 6000, 10000, 4, 1000);
    const oldReview = m(R, 3000, 10000, 1, 2000);
    const checkpoint = m(C, 8000, 10000, 5, 3000);
    const newReview = m(R, 10000, 10000, 1, 4000);
    const r = mergeSkillV2([diag, oldReview, checkpoint, newReview])!;
    expect(r.anchorMeasurementId).toBe(checkpoint.id);
    expect(r.includedMeasurementIds.sort()).toEqual([checkpoint.id, newReview.id].sort());
    expect(r.masteryScoreBp).toBe(8333); // round((8000·5 + 10000·1)/6)
  });

  it('§27/§62 v1 compatibility: histories with no REVIEW_MASTERY produce identical v1/v2 results', () => {
    const fixtures: NormalizedMeasurement[][] = [
      [m(D, 6000, 10000, 4, 1000), m(L, 9000, 10000, 1, 2000)],
      [m(D, 6000, 5000, 2, 1000), m(L, 9000, 10000, 1, 2000)],
      [m(D, 6000, 10000, 4, 1000), m(L, 8000, 10000, 1, 2000), m(L, 10000, 10000, 2, 3000)],
      [m(D, 4000, 10000, 3, 1000), m(L, 7000, 10000, 1, 1500), m(D, 6000, 10000, 4, 2000), m(L, 9000, 10000, 1, 2500)],
      [m(L, 8000, 10000, 1, 1000), m(L, 10000, 10000, 1, 2000)],
    ];
    for (const f of fixtures) expect(mergeSkillV2(f)).toEqual(mergeSkill(f));
  });

  it('unsupported sources (AI_EVALUATION / ENGINE_RECALC) still excluded', () => {
    const r = mergeSkillV2([m(R, 6000, 10000, 4, 1000), m(SkillMeasurementSource.AI_EVALUATION, 10000, 10000, 9, 5000)])!;
    expect(r).toMatchObject({ masteryScoreBp: 6000, evidenceCount: 4 });
  });

  it('no supported measurement → null', () => {
    expect(mergeSkillV2([m(SkillMeasurementSource.ENGINE_RECALC, 5000, 10000, 1, 1000)])).toBeNull();
  });
});
