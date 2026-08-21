import { GapRankingEngine } from './gap-ranking.engine';
import { MeasuredSkill } from './gap-ranking.types';

const m = (skillId: string, mastery: number, confidence: number, evidence = 1): MeasuredSkill => ({ skillId, masteryScoreBp: mastery, confidenceBp: confidence, evidenceCount: evidence });

describe('GapRankingEngine (roadmap-gap-v1)', () => {
  const engine = new GapRankingEngine();

  it('§40 gapPriority = (10000 − mastery) × confidence / 10000', () => {
    const r = engine.rank([m('a', 2000, 10000), m('b', 2000, 2500), m('c', 10000, 10000)]);
    const byId = Object.fromEntries(r.map((x) => [x.skillId, x.gapPriorityBp]));
    expect(byId.a).toBe(8000); // confident gap
    expect(byId.b).toBe(2000); // weak-looking but low evidence coverage
    expect(byId.c).toBe(0); // full mastery → no gap
  });

  it('§41 high-mastery skill is still ranked (no threshold drop)', () => {
    const r = engine.rank([m('x', 9500, 10000)]);
    expect(r).toHaveLength(1);
    expect(r[0].gapPriorityBp).toBe(500);
  });

  it('sorted by gapPriority DESC, then deterministic tie-break (skillId ASC)', () => {
    const r = engine.rank([m('a', 2000, 10000), m('c', 10000, 10000), m('b', 2000, 10000)]);
    expect(r.map((x) => x.skillId)).toEqual(['a', 'b', 'c']); // a,b tie at 8000 → skillId asc; c=0 last
  });

  it('tie on priority → lower mastery ranks first', () => {
    // hi: (10000−6000)×10000/10000 = 4000 ; lo: (10000−2000)×5000/10000 = 4000 → same priority
    const r = engine.rank([m('hi', 6000, 10000), m('lo', 2000, 5000)]);
    expect(r.map((x) => x.skillId)).toEqual(['lo', 'hi']);
  });

  it('guards non-finite / out-of-range input into [0,10000]', () => {
    const r = engine.rank([{ skillId: 'a', masteryScoreBp: Number.NaN, confidenceBp: 5000, evidenceCount: 1 }]);
    expect(r[0].gapPriorityBp).toBeGreaterThanOrEqual(0);
    expect(r[0].gapPriorityBp).toBeLessThanOrEqual(10000);
  });

  it('empty input → empty ranking', () => {
    expect(engine.rank([])).toEqual([]);
  });
});
