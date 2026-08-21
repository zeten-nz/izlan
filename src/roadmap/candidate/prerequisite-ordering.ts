import { RoadmapConfigurationInvalidError } from '../../common/errors';

/**
 * Pure prerequisite-graph primitives (§13/14/15/29). All deterministic, no DB/HTTP/AI.
 * `prereqOf.get(lessonId)` = the lessons that lessonId REQUIRES (must precede it).
 * A cycle in corrupted data fails safely as ROADMAP_CONFIGURATION_INVALID (never infinite-loops).
 */

export interface OwnerPriority {
  bp: number; // effective gap priority (0..10000); −1 sentinel = no direct mapping
  skillId: string; // originating gap skill (empty only for the −1 sentinel)
}

export interface OrderItem {
  lessonId: string;
  priorityBp: number;
  topicSortOrder: number;
  lessonSortOrder: number;
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * A seed (directly-selected includable lesson) is REACHABLE iff every uncompleted prerequisite is,
 * transitively, includable and reachable (completed prerequisites are already satisfied). Returns the
 * includable lessons actually needed (reachable seeds + their uncompleted-includable prereq closure)
 * and the seeds that are blocked (an uncompleted prerequisite is not learner-visible). Cycle → throws.
 */
export function computeReachableClosure(
  seeds: string[],
  prereqOf: Map<string, string[]>,
  completed: ReadonlySet<string>,
  includable: ReadonlySet<string>,
): { reachable: Set<string>; unreachableSeeds: Set<string> } {
  const reachableMemo = new Map<string, boolean>();
  const color = new Map<string, number>();

  const reachable = (lesson: string): boolean => {
    const cached = reachableMemo.get(lesson);
    if (cached !== undefined) return cached;
    if (color.get(lesson) === GRAY) throw new RoadmapConfigurationInvalidError('prerequisite cycle');
    color.set(lesson, GRAY);
    let ok = true;
    for (const p of prereqOf.get(lesson) ?? []) {
      if (completed.has(p)) continue; // satisfied
      if (!includable.has(p) || !reachable(p)) ok = false; // uncompleted + not visible / unreachable → blocks
    }
    color.set(lesson, BLACK);
    reachableMemo.set(lesson, ok);
    return ok;
  };

  const needed = new Set<string>();
  const collect = (lesson: string): void => {
    if (needed.has(lesson)) return;
    needed.add(lesson);
    for (const p of prereqOf.get(lesson) ?? []) {
      if (!completed.has(p) && includable.has(p)) collect(p);
    }
  };

  const unreachableSeeds = new Set<string>();
  for (const s of seeds) {
    if (reachable(s)) collect(s);
    else unreachableSeeds.add(s);
  }
  return { reachable: needed, unreachableSeeds };
}

/**
 * Effective priority per needed lesson: a prerequisite inherits the highest priority of anything it
 * unblocks (§14/29), so it sorts adjacent to its high-priority dependent. Tie → smaller skillId.
 */
export function effectivePriorities(needed: ReadonlySet<string>, direct: Map<string, OwnerPriority>, prereqOf: Map<string, string[]>): Map<string, OwnerPriority> {
  const dependentsOf = new Map<string, string[]>();
  for (const lesson of needed) {
    for (const p of prereqOf.get(lesson) ?? []) {
      if (needed.has(p)) (dependentsOf.get(p) ?? dependentsOf.set(p, []).get(p)!).push(lesson);
    }
  }
  const memo = new Map<string, OwnerPriority>();
  const better = (a: OwnerPriority, b: OwnerPriority): OwnerPriority => {
    if (b.bp > a.bp) return b;
    if (b.bp === a.bp && b.skillId !== '' && (a.skillId === '' || b.skillId < a.skillId)) return b;
    return a;
  };
  const compute = (lesson: string): OwnerPriority => {
    const cached = memo.get(lesson);
    if (cached) return cached;
    memo.set(lesson, { bp: -1, skillId: '' }); // cycle guard (graph already acyclic)
    let best: OwnerPriority = direct.get(lesson) ?? { bp: -1, skillId: '' };
    for (const d of dependentsOf.get(lesson) ?? []) best = better(best, compute(d));
    memo.set(lesson, best);
    return best;
  };
  const out = new Map<string, OwnerPriority>();
  for (const lesson of needed) out.set(lesson, compute(lesson));
  return out;
}

/**
 * Priority-aware topological order (§16/29): prereq before dependent; among currently-unblocked nodes,
 * highest priorityBp wins, then topicSortOrder, lessonSortOrder, lessonId. Cycle → throws.
 */
export function priorityTopoOrder(items: OrderItem[], prereqOf: Map<string, string[]>): string[] {
  const inSet = new Set(items.map((i) => i.lessonId));
  const meta = new Map(items.map((i) => [i.lessonId, i]));
  const indegree = new Map<string, number>();
  const dependentsOf = new Map<string, string[]>();
  for (const i of items) indegree.set(i.lessonId, 0);
  for (const i of items) {
    for (const p of prereqOf.get(i.lessonId) ?? []) {
      if (!inSet.has(p)) continue; // completed/absent prereqs don't constrain the item set
      indegree.set(i.lessonId, indegree.get(i.lessonId)! + 1);
      (dependentsOf.get(p) ?? dependentsOf.set(p, []).get(p)!).push(i.lessonId);
    }
  }
  const cmp = (a: string, b: string): number => {
    const ma = meta.get(a)!;
    const mb = meta.get(b)!;
    return mb.priorityBp - ma.priorityBp || ma.topicSortOrder - mb.topicSortOrder || ma.lessonSortOrder - mb.lessonSortOrder || (a < b ? -1 : a > b ? 1 : 0);
  };
  const available = items.filter((i) => indegree.get(i.lessonId) === 0).map((i) => i.lessonId);
  const order: string[] = [];
  while (available.length > 0) {
    available.sort(cmp);
    const next = available.shift()!;
    order.push(next);
    for (const d of dependentsOf.get(next) ?? []) {
      indegree.set(d, indegree.get(d)! - 1);
      if (indegree.get(d) === 0) available.push(d);
    }
  }
  if (order.length !== items.length) throw new RoadmapConfigurationInvalidError('prerequisite cycle');
  return order;
}
