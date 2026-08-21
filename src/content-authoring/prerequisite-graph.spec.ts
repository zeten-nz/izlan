import { PrereqEdge, hasPath, wouldCreatePrerequisiteCycle } from './prerequisite-graph';

const E = (lessonId: string, prerequisiteLessonId: string): PrereqEdge => ({ lessonId, prerequisiteLessonId });

describe('prerequisite-graph (full-DAG cycle detection, TD-249)', () => {
  it('DAG-01 empty graph → A requires B accepted', () => {
    expect(wouldCreatePrerequisiteCycle([], 'A', 'B')).toBe(false);
  });
  it('DAG-02 A→B then B→A rejected', () => {
    expect(wouldCreatePrerequisiteCycle([E('A', 'B')], 'B', 'A')).toBe(true);
  });
  it('DAG-03 A→B, B→C, add C→A rejected', () => {
    expect(wouldCreatePrerequisiteCycle([E('A', 'B'), E('B', 'C')], 'C', 'A')).toBe(true);
  });
  it('DAG-04 long cycle rejected (A→B→C→D, add D→A)', () => {
    expect(wouldCreatePrerequisiteCycle([E('A', 'B'), E('B', 'C'), E('C', 'D')], 'D', 'A')).toBe(true);
  });
  it('DAG-05 disconnected graph → unrelated edge accepted', () => {
    expect(wouldCreatePrerequisiteCycle([E('A', 'B'), E('C', 'D')], 'E', 'F')).toBe(false);
  });
  it('DAG-06 diamond DAG accepted (A→B, A→C, add B→D and C→D — no cycle)', () => {
    const edges = [E('A', 'B'), E('A', 'C'), E('B', 'D')];
    expect(wouldCreatePrerequisiteCycle(edges, 'C', 'D')).toBe(false); // C→D closes a diamond, not a cycle
  });
  it('DAG-07 self-loop is a cycle', () => {
    expect(wouldCreatePrerequisiteCycle([], 'A', 'A')).toBe(true);
  });
  it('hasPath basics (reachability, no false positives)', () => {
    const edges = [E('A', 'B'), E('B', 'C')];
    expect(hasPath(edges, 'A', 'C')).toBe(true);
    expect(hasPath(edges, 'C', 'A')).toBe(false);
    expect(hasPath(edges, 'A', 'A')).toBe(true);
  });
  it('deep chain does not overflow the stack (iterative)', () => {
    const edges: PrereqEdge[] = [];
    for (let i = 0; i < 20000; i++) edges.push(E(`n${i}`, `n${i + 1}`));
    expect(hasPath(edges, 'n0', 'n20000')).toBe(true);
    expect(wouldCreatePrerequisiteCycle(edges, 'n20000', 'n0')).toBe(true); // would close the whole chain
  });
});
