import { RoadmapItemView, selectPlanItems } from './plan-selection';

const item = (id: string, position: number, state: string, lessonId: string, skillId = 's'): RoadmapItemView => ({ id, position, state, skillId, lesson: { id: lessonId, title: `t-${lessonId}` } });
// topicOf maps lessonId → topicId
const topics = (entries: [string, string][]) => new Map(entries);

describe('selectPlanItems (daily-plan-roadmap-v1)', () => {
  it('§42 MUST_DO = nextItem; RECOMMENDED = later same-Topic items', () => {
    const items = [item('i1', 1, 'COMPLETED', 'l1'), item('i2', 2, 'BLOCKED', 'l2'), item('i3', 3, 'AVAILABLE', 'l3'), item('i4', 4, 'AVAILABLE', 'l4')];
    const topicOf = topics([['l1', 'A'], ['l2', 'A'], ['l3', 'A'], ['l4', 'A']]);
    const out = selectPlanItems(items, 'i3', topicOf)!;
    expect(out.topicId).toBe('A');
    expect(out.planItems.map((p) => [p.section, p.roadmapItemId, p.position])).toEqual([
      ['MUST_DO', 'i3', 1],
      ['RECOMMENDED', 'i4', 2],
    ]);
  });

  it('§43 MUST_DO follows nextItemId (IN_PROGRESS priority from 1.6B); earlier item excluded', () => {
    const items = [item('i1', 1, 'AVAILABLE', 'l1'), item('i2', 2, 'IN_PROGRESS', 'l2')];
    const out = selectPlanItems(items, 'i2', topics([['l1', 'A'], ['l2', 'A']]))!;
    expect(out.planItems).toHaveLength(1); // i1 is before MUST_DO position → not included
    expect(out.planItems[0]).toMatchObject({ section: 'MUST_DO', roadmapItemId: 'i2' });
  });

  it('§44 RECOMMENDED only same Topic; other-Topic items excluded', () => {
    const items = [item('a1', 1, 'AVAILABLE', 'la1'), item('a2', 2, 'AVAILABLE', 'la2'), item('a3', 3, 'BLOCKED', 'la3'), item('b1', 4, 'AVAILABLE', 'lb1')];
    const topicOf = topics([['la1', 'A'], ['la2', 'A'], ['la3', 'A'], ['lb1', 'B']]);
    const out = selectPlanItems(items, 'a1', topicOf)!;
    expect(out.planItems.map((p) => p.roadmapItemId)).toEqual(['a1', 'a2', 'a3']); // b1 (Topic B) excluded
  });

  it('§45 already-COMPLETED later same-Topic item excluded', () => {
    const items = [item('a1', 1, 'AVAILABLE', 'la1'), item('a2', 2, 'COMPLETED', 'la2'), item('a3', 3, 'AVAILABLE', 'la3')];
    const out = selectPlanItems(items, 'a1', topics([['la1', 'A'], ['la2', 'A'], ['la3', 'A']]))!;
    expect(out.planItems.map((p) => p.roadmapItemId)).toEqual(['a1', 'a3']); // a2 completed → excluded
  });

  it('§46 BLOCKED later same-Topic item is INCLUDED as RECOMMENDED (day scope, not clickability)', () => {
    const items = [item('a1', 1, 'AVAILABLE', 'la1'), item('a2', 2, 'BLOCKED', 'la2')];
    const out = selectPlanItems(items, 'a1', topics([['la1', 'A'], ['la2', 'A']]))!;
    expect(out.planItems.map((p) => [p.section, p.roadmapItemId])).toEqual([['MUST_DO', 'a1'], ['RECOMMENDED', 'a2']]);
  });

  it('UNAVAILABLE later same-Topic item excluded at generation', () => {
    const items = [item('a1', 1, 'AVAILABLE', 'la1'), item('a2', 2, 'UNAVAILABLE', 'la2')];
    const out = selectPlanItems(items, 'a1', topics([['la1', 'A'], ['la2', 'A']]))!;
    expect(out.planItems.map((p) => p.roadmapItemId)).toEqual(['a1']);
  });

  it('null nextItemId → null (no plan)', () => {
    expect(selectPlanItems([item('a1', 1, 'BLOCKED', 'la1')], null, topics([['la1', 'A']]))).toBeNull();
  });

  it('nextItem not found → null', () => {
    expect(selectPlanItems([item('a1', 1, 'AVAILABLE', 'la1')], 'ghost', topics([['la1', 'A']]))).toBeNull();
  });
});
