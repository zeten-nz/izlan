import { DerivedItem, ProgressContext, deriveItemState, deriveItems, nextItemId, summarize } from './roadmap-progress';

const ctx = (over: Partial<{ completed: string[]; inProgress: string[]; available: string[]; prereqOf: [string, string[]][] }> = {}): ProgressContext => ({
  completed: new Set(over.completed ?? []),
  inProgress: new Set(over.inProgress ?? []),
  available: new Set(over.available ?? []),
  prereqOf: new Map(over.prereqOf ?? []),
});

describe('deriveItemState — precedence COMPLETED > UNAVAILABLE > IN_PROGRESS > BLOCKED > AVAILABLE', () => {
  it('COMPLETED wins even when content is unavailable (completion history, §4/6)', () => {
    expect(deriveItemState('L', ctx({ completed: ['L'], available: [] }))).toBe('COMPLETED');
  });
  it('UNAVAILABLE wins over IN_PROGRESS (§6/11)', () => {
    expect(deriveItemState('L', ctx({ inProgress: ['L'], available: [] }))).toBe('UNAVAILABLE');
  });
  it('IN_PROGRESS when available + started + not completed', () => {
    expect(deriveItemState('L', ctx({ available: ['L'], inProgress: ['L'] }))).toBe('IN_PROGRESS');
  });
  it('BLOCKED when a prerequisite is not completed', () => {
    expect(deriveItemState('C', ctx({ available: ['C'], prereqOf: [['C', ['B']]] }))).toBe('BLOCKED');
  });
  it('AVAILABLE when visible, unstarted, all prerequisites completed', () => {
    expect(deriveItemState('C', ctx({ available: ['C'], completed: ['B'], prereqOf: [['C', ['B']]] }))).toBe('AVAILABLE');
  });
  it('null lessonId → UNAVAILABLE', () => {
    expect(deriveItemState(null, ctx())).toBe('UNAVAILABLE');
  });
  it('§8/30 external (non-roadmap) prerequisite still gates on completion', () => {
    expect(deriveItemState('C', ctx({ available: ['C'], prereqOf: [['C', ['EXT']]] }))).toBe('BLOCKED');
    expect(deriveItemState('C', ctx({ available: ['C'], completed: ['EXT'], prereqOf: [['C', ['EXT']]] }))).toBe('AVAILABLE');
  });
});

describe('§29 prerequisite chain transitions A→B→C', () => {
  const prereqOf: [string, string[]][] = [['B', ['A']], ['C', ['B']]];
  const avail = ['A', 'B', 'C'];
  const state = (lesson: string, over: Parameters<typeof ctx>[0]) => deriveItemState(lesson, ctx({ available: avail, prereqOf, ...over }));

  it('none completed → A AVAILABLE, B BLOCKED, C BLOCKED', () => {
    expect([state('A', {}), state('B', {}), state('C', {})]).toEqual(['AVAILABLE', 'BLOCKED', 'BLOCKED']);
  });
  it('A completed → A COMPLETED, B AVAILABLE, C BLOCKED', () => {
    const o = { available: avail, prereqOf, completed: ['A'] };
    expect([deriveItemState('A', ctx(o)), deriveItemState('B', ctx(o)), deriveItemState('C', ctx(o))]).toEqual(['COMPLETED', 'AVAILABLE', 'BLOCKED']);
  });
  it('A completed + B in-progress → B IN_PROGRESS', () => {
    expect(state('B', { completed: ['A'], inProgress: ['B'] })).toBe('IN_PROGRESS');
  });
  it('A,B completed → B COMPLETED, C AVAILABLE', () => {
    const o = { available: avail, prereqOf, completed: ['A', 'B'] };
    expect([deriveItemState('B', ctx(o)), deriveItemState('C', ctx(o))]).toEqual(['COMPLETED', 'AVAILABLE']);
  });
});

describe('summarize + nextItemId', () => {
  const items = (states: [string, number, string | null][]): DerivedItem[] => states.map(([roadmapItemId, position, lessonId]) => ({ roadmapItemId, position, lessonId, state: 'AVAILABLE' as const }));

  it('§31 progress summary is consistent', () => {
    const derived: DerivedItem[] = [
      { roadmapItemId: 'i1', position: 1, lessonId: 'a', state: 'COMPLETED' },
      { roadmapItemId: 'i2', position: 2, lessonId: 'b', state: 'COMPLETED' },
      { roadmapItemId: 'i3', position: 3, lessonId: 'c', state: 'IN_PROGRESS' },
      { roadmapItemId: 'i4', position: 4, lessonId: 'd', state: 'AVAILABLE' },
      { roadmapItemId: 'i5', position: 5, lessonId: 'e', state: 'BLOCKED' },
    ];
    expect(summarize(derived)).toEqual({ total: 5, completed: 2, inProgress: 1, available: 1, blocked: 1, unavailable: 0, progressBp: 4000 });
  });

  it('empty roadmap → progressBp 0 (fail-safe)', () => {
    expect(summarize([]).progressBp).toBe(0);
  });

  it('§32 next = earliest AVAILABLE when no IN_PROGRESS', () => {
    const derived: DerivedItem[] = [
      { roadmapItemId: 'i1', position: 1, lessonId: 'a', state: 'COMPLETED' },
      { roadmapItemId: 'i2', position: 2, lessonId: 'b', state: 'BLOCKED' },
      { roadmapItemId: 'i3', position: 3, lessonId: 'c', state: 'AVAILABLE' },
      { roadmapItemId: 'i4', position: 4, lessonId: 'd', state: 'AVAILABLE' },
    ];
    expect(nextItemId(derived)).toBe('i3');
  });

  it('§32 IN_PROGRESS wins over an earlier AVAILABLE', () => {
    const derived: DerivedItem[] = [
      { roadmapItemId: 'i3', position: 3, lessonId: 'c', state: 'AVAILABLE' },
      { roadmapItemId: 'i4', position: 4, lessonId: 'd', state: 'IN_PROGRESS' },
    ];
    expect(nextItemId(derived)).toBe('i4');
  });

  it('all COMPLETED → nextItemId null', () => {
    const derived: DerivedItem[] = [{ roadmapItemId: 'i1', position: 1, lessonId: 'a', state: 'COMPLETED' }];
    expect(nextItemId(derived)).toBeNull();
    void items;
  });
});
