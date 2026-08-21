/**
 * Pure prerequisite-DAG helpers (Phase 2.2A-3, TD-249). A LessonPrerequisite edge `{ lessonId, prerequisiteLessonId }`
 * means "lessonId requires prerequisiteLessonId" — a directed edge lessonId → prerequisiteLessonId. The prerequisite
 * graph must stay acyclic. Iterative (non-recursive) DFS avoids stack-depth risk on long chains.
 */
export interface PrereqEdge {
  lessonId: string;
  prerequisiteLessonId: string;
}

/** Is there a directed path `from → … → to` following the edges? `from === to` counts as a trivial path. */
export function hasPath(edges: readonly PrereqEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.lessonId);
    if (list) list.push(e.prerequisiteLessonId);
    else adj.set(e.lessonId, [e.prerequisiteLessonId]);
  }
  const stack: string[] = [from];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return false;
}

/**
 * Would adding `lessonId → prerequisiteLessonId` create a directed cycle in the existing graph? True iff it is a
 * self-loop, OR a path prerequisiteLessonId → … → lessonId already exists (which the new edge would close). `edges`
 * must be the WHOLE Subject graph (all edges whose source Lesson belongs to the Subject), not just neighbours (§26).
 */
export function wouldCreatePrerequisiteCycle(edges: readonly PrereqEdge[], lessonId: string, prerequisiteLessonId: string): boolean {
  if (lessonId === prerequisiteLessonId) return true;
  return hasPath(edges, prerequisiteLessonId, lessonId);
}
