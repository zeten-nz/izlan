import { PlacementEngineService } from './placement-engine.service';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION, PlacementConfig, PoolItem } from './placement-engine.types';

function cfg(over: { startDifficulty?: number; stepUp?: number; stepDown?: number; itemsPerSkill?: number; maxItems?: number } = {}): PlacementConfig {
  return {
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION,
    engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: over.startDifficulty ?? 3, stepUp: over.stepUp ?? 1, stepDown: over.stepDown ?? 1 },
    coverage: { itemsPerSkill: over.itemsPerSkill ?? 2 },
    stopping: { maxItems: over.maxItems ?? 10 },
    profileScale: { minDifficulty: 1, maxDifficulty: 6 },
  };
}
const item = (itemId: string, skillId: string, difficulty: number): PoolItem => ({ itemId, skillId, difficulty });
// Two skills, four difficulties each.
const TWO_SKILL: PoolItem[] = [
  item('a1', 'skA', 1), item('a2', 'skA', 2), item('a3', 'skA', 3), item('a4', 'skA', 4),
  item('b1', 'skB', 1), item('b2', 'skB', 2), item('b3', 'skB', 3), item('b4', 'skB', 4),
];

function run(engine: PlacementEngineService, config: PlacementConfig, pool: PoolItem[], answerFn: (itemId: string) => boolean) {
  let state = engine.initialState(config, pool);
  const seq: { itemId: string; skillId: string }[] = [];
  while (!engine.isComplete(config, state, pool)) {
    const next = engine.pickItem(config, state, pool);
    if (!next) break;
    state = engine.markPresented(state, next);
    const skillId = pool.find((p) => p.itemId === next)!.skillId;
    seq.push({ itemId: next, skillId });
    state = engine.applyResult(config, state, skillId, answerFn(next));
  }
  return { seq, state };
}

describe('PlacementEngineService (per-skill, skill-balanced)', () => {
  const engine = new PlacementEngineService();

  it('initial state derives distinct skills from the pinned pool', () => {
    const s = engine.initialState(cfg({ startDifficulty: 4 }), TWO_SKILL);
    expect(Object.keys(s.skills).sort()).toEqual(['skA', 'skB']);
    expect(s.skills.skA).toEqual({ targetDifficulty: 4, answeredCount: 0 });
    expect(s.skills.skB).toEqual({ targetDifficulty: 4, answeredCount: 0 });
    expect(s.answeredCount).toBe(0);
  });

  it('§31 skill-balanced: itemsPerSkill=2 → exactly 2 evidence per skill; never one skill exhausts quota alone', () => {
    const { seq } = run(engine, cfg({ itemsPerSkill: 2, maxItems: 10 }), TWO_SKILL, () => true);
    const a = seq.filter((x) => x.skillId === 'skA').length;
    const b = seq.filter((x) => x.skillId === 'skB').length;
    expect(a).toBe(2);
    expect(b).toBe(2);
    // balance invariant: running counts never diverge by more than 1
    let ca = 0, cb = 0;
    for (const x of seq) {
      if (x.skillId === 'skA') ca++; else cb++;
      expect(Math.abs(ca - cb)).toBeLessThanOrEqual(1);
    }
  });

  it('§32 per-skill difficulty independence: answering one skill never moves another skill target', () => {
    const state0 = engine.initialState(cfg({ startDifficulty: 3 }), TWO_SKILL);
    const first = engine.pickItem(cfg(), state0, TWO_SKILL)!;
    const firstSkill = TWO_SKILL.find((p) => p.itemId === first)!.skillId;
    expect(firstSkill).toBe('skA'); // tie-break skillId ascending
    const state1 = engine.applyResult(cfg({ stepUp: 1 }), engine.markPresented(state0, first), 'skA', true);
    expect(state1.skills.skA.targetDifficulty).toBe(4); // moved
    expect(state1.skills.skB.targetDifficulty).toBe(3); // UNCHANGED
  });

  it('within a skill: correct → target up, incorrect → down (floored at 1)', () => {
    let s = engine.initialState(cfg({ startDifficulty: 2, stepUp: 2, stepDown: 5 }), TWO_SKILL);
    s = engine.applyResult(cfg({ startDifficulty: 2, stepUp: 2, stepDown: 5 }), s, 'skA', true);
    expect(s.skills.skA.targetDifficulty).toBe(4);
    s = engine.applyResult(cfg({ startDifficulty: 2, stepUp: 2, stepDown: 5 }), s, 'skA', false);
    expect(s.skills.skA.targetDifficulty).toBe(1); // max(1, 4-5)
  });

  it('§33 coverage failure: a skill with too few items finishes without repeats and is reported insufficient', () => {
    const pool: PoolItem[] = [item('a1', 'skA', 1), item('a2', 'skA', 2), item('b1', 'skB', 1)]; // skB has only 1
    const config = cfg({ itemsPerSkill: 2, maxItems: 10 });
    const { seq, state } = run(engine, config, pool, () => true);
    expect(seq.filter((x) => x.skillId === 'skA').length).toBe(2);
    expect(seq.filter((x) => x.skillId === 'skB').length).toBe(1); // only 1 available, no repeat
    expect(new Set(seq.map((x) => x.itemId)).size).toBe(seq.length); // no repeats
    const cov = engine.coverage(config, state, pool);
    expect(cov.complete).toBe(false);
    expect(cov.insufficientSkillIds).toEqual(['skB']);
  });

  it('coverage complete when every skill meets quota', () => {
    const config = cfg({ itemsPerSkill: 2, maxItems: 10 });
    const { state } = run(engine, config, TWO_SKILL, () => true);
    expect(engine.coverage(config, state, TWO_SKILL)).toEqual({ complete: true, insufficientSkillIds: [] });
  });

  it('never repeats an item; deterministic (same inputs → same sequence)', () => {
    const a = run(engine, cfg(), TWO_SKILL, () => true).seq;
    const b = run(engine, cfg(), TWO_SKILL, () => true).seq;
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.itemId)).size).toBe(a.length);
  });

  it('isComplete: maxItems cap, all-skills-at-quota, and pool exhaustion', () => {
    const capped = { ...engine.initialState(cfg({ maxItems: 2 }), TWO_SKILL), answeredCount: 2 };
    expect(engine.isComplete(cfg({ maxItems: 2 }), capped, TWO_SKILL)).toBe(true);

    const quotaMet = engine.initialState(cfg({ itemsPerSkill: 1 }), TWO_SKILL);
    quotaMet.skills.skA.answeredCount = 1;
    quotaMet.skills.skB.answeredCount = 1;
    expect(engine.isComplete(cfg({ itemsPerSkill: 1 }), quotaMet, TWO_SKILL)).toBe(true);

    const exhausted = { ...engine.initialState(cfg({ itemsPerSkill: 9, maxItems: 99 }), TWO_SKILL), presentedItemIds: TWO_SKILL.map((p) => p.itemId) };
    expect(engine.isComplete(cfg({ itemsPerSkill: 9, maxItems: 99 }), exhausted, TWO_SKILL)).toBe(true);
  });

  it('within-skill difficulty targeting picks the nearest unseen item, deterministic tie-break', () => {
    // skA only; target 3 → a3; then correct → target 4 → a4
    const pool: PoolItem[] = [item('a1', 'skA', 1), item('a2', 'skA', 2), item('a3', 'skA', 3), item('a4', 'skA', 4)];
    const config = cfg({ startDifficulty: 3, itemsPerSkill: 4, maxItems: 10 });
    const { seq } = run(engine, config, pool, (id) => id === 'a3'); // a3 correct, rest incorrect
    expect(seq[0].itemId).toBe('a3'); // nearest 3
    expect(seq[1].itemId).toBe('a4'); // correct → target 4
  });
});
