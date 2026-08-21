import { RoadmapConfigurationInvalidError } from '../../common/errors';
import { OrderItem, computeReachableClosure, effectivePriorities, priorityTopoOrder } from './prerequisite-ordering';

const prereq = (entries: [string, string[]][]) => new Map(entries);
const item = (lessonId: string, priorityBp: number, lessonSortOrder = 0, topicSortOrder = 0): OrderItem => ({ lessonId, priorityBp, topicSortOrder, lessonSortOrder });

describe('priorityTopoOrder', () => {
  it('§45 prerequisite precedes dependent: C requires B requires A → A,B,C', () => {
    const items = [item('C', 9000, 2), item('B', 9000, 1), item('A', 9000, 0)];
    expect(priorityTopoOrder(items, prereq([['C', ['B']], ['B', ['A']]]))).toEqual(['A', 'B', 'C']);
  });

  it('§15 cycle → ROADMAP_CONFIGURATION_INVALID (no infinite loop)', () => {
    const items = [item('A', 1000), item('B', 1000)];
    expect(() => priorityTopoOrder(items, prereq([['A', ['B']], ['B', ['A']]]))).toThrow(RoadmapConfigurationInvalidError);
  });

  it('among independent nodes: higher priority first, then hierarchy, then id', () => {
    const items = [item('lo', 1000, 0), item('hi', 9000, 5), item('mid', 9000, 1)];
    expect(priorityTopoOrder(items, prereq([]))).toEqual(['mid', 'hi', 'lo']); // hi/mid tie 9000 → lessonSortOrder 1<5 → mid first
  });

  it('completed/absent prerequisites (not in item set) do not constrain', () => {
    const items = [item('C', 9000)]; // B is completed → absent from items
    expect(priorityTopoOrder(items, prereq([['C', ['B']]]))).toEqual(['C']);
  });
});

describe('computeReachableClosure', () => {
  it('§45 all-eligible chain is fully reachable', () => {
    const { reachable, unreachableSeeds } = computeReachableClosure(['C'], prereq([['C', ['B']], ['B', ['A']]]), new Set(), new Set(['A', 'B', 'C']));
    expect([...reachable].sort()).toEqual(['A', 'B', 'C']);
    expect(unreachableSeeds.size).toBe(0);
  });

  it('completed prerequisite is satisfied and not included as an item', () => {
    const { reachable } = computeReachableClosure(['C'], prereq([['C', ['B']], ['B', ['A']]]), new Set(['A']), new Set(['B', 'C']));
    expect([...reachable].sort()).toEqual(['B', 'C']); // A completed → not an item
  });

  it('uncompleted non-visible prerequisite blocks the seed (unreachable)', () => {
    const { reachable, unreachableSeeds } = computeReachableClosure(['C'], prereq([['C', ['B']]]), new Set(), new Set(['C'])); // B not includable
    expect(reachable.size).toBe(0);
    expect([...unreachableSeeds]).toEqual(['C']);
  });

  it('cycle → throws', () => {
    expect(() => computeReachableClosure(['A'], prereq([['A', ['B']], ['B', ['A']]]), new Set(), new Set(['A', 'B']))).toThrow(RoadmapConfigurationInvalidError);
  });
});

describe('effectivePriorities', () => {
  it('§14 prerequisite inherits its dependent’s priority + originating skill', () => {
    const needed = new Set(['A', 'B', 'C']);
    const direct = new Map([['C', { bp: 9000, skillId: 's1' }]]);
    const eff = effectivePriorities(needed, direct, prereq([['C', ['B']], ['B', ['A']]]));
    expect(eff.get('A')).toEqual({ bp: 9000, skillId: 's1' });
    expect(eff.get('B')).toEqual({ bp: 9000, skillId: 's1' });
    expect(eff.get('C')).toEqual({ bp: 9000, skillId: 's1' });
  });

  it('a directly-mapped lesson keeps its own higher priority over a low-priority dependent', () => {
    const needed = new Set(['P', 'D']);
    const direct = new Map([['P', { bp: 8000, skillId: 'sP' }], ['D', { bp: 1000, skillId: 'sD' }]]);
    const eff = effectivePriorities(needed, direct, prereq([['D', ['P']]])); // D requires P
    expect(eff.get('P')!.bp).toBe(8000); // P's own priority wins over dependent D (1000)
  });
});
