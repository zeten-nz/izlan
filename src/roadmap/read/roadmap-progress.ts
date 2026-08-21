/**
 * Pure roadmap read-model derivation (TD-101). No DB/HTTP/AI. Roadmap = plan; LearnerLessonCompletion =
 * completion truth (§2) — RoadmapItem is never a second completion authority, and nothing here is persisted.
 *
 * Derived item-state precedence (§11): COMPLETED > UNAVAILABLE > IN_PROGRESS > BLOCKED > AVAILABLE.
 */
export type RoadmapItemState = 'COMPLETED' | 'UNAVAILABLE' | 'IN_PROGRESS' | 'BLOCKED' | 'AVAILABLE';

export interface ProgressContext {
  completed: ReadonlySet<string>; // lessonIds with an authoritative completion (all of the learner's)
  inProgress: ReadonlySet<string>; // lessonIds the learner has begun
  available: ReadonlySet<string>; // lessonIds currently learner-visible/executable
  prereqOf: ReadonlyMap<string, string[]>; // lessonId → prerequisite lessonIds
}

export interface DerivedItem {
  roadmapItemId: string;
  position: number;
  lessonId: string | null;
  state: RoadmapItemState;
}

/** Derive one item's read-model state (§4-11). A null lessonId (non-lesson item) is UNAVAILABLE. */
export function deriveItemState(lessonId: string | null, ctx: ProgressContext): RoadmapItemState {
  if (!lessonId) return 'UNAVAILABLE';
  if (ctx.completed.has(lessonId)) return 'COMPLETED'; // completion history wins even if content later archived (§4/6)
  if (!ctx.available.has(lessonId)) return 'UNAVAILABLE'; // valid at generation, later unpublished/archived (§6)
  if (ctx.inProgress.has(lessonId)) return 'IN_PROGRESS'; // started; UNAVAILABLE already took precedence (§5/11)
  // Prerequisite satisfied iff the prerequisite lesson is COMPLETED — roadmap membership/order is NOT completion (§8).
  const prereqs = ctx.prereqOf.get(lessonId) ?? [];
  if (prereqs.some((p) => !ctx.completed.has(p))) return 'BLOCKED';
  return 'AVAILABLE';
}

/** Items must already be sorted by position ASC (canonical roadmap order, §12). */
export function deriveItems(items: { roadmapItemId: string; position: number; lessonId: string | null }[], ctx: ProgressContext): DerivedItem[] {
  return items.map((i) => ({ ...i, state: deriveItemState(i.lessonId, ctx) }));
}

export interface ProgressSummary {
  total: number;
  completed: number;
  inProgress: number;
  available: number;
  blocked: number;
  unavailable: number;
  progressBp: number; // 0..10000; NOT persisted
}

export function summarize(items: DerivedItem[]): ProgressSummary {
  const c = { COMPLETED: 0, IN_PROGRESS: 0, AVAILABLE: 0, BLOCKED: 0, UNAVAILABLE: 0 } as Record<RoadmapItemState, number>;
  for (const i of items) c[i.state] += 1;
  const total = items.length;
  const progressBp = total > 0 ? Math.max(0, Math.min(10000, Math.round((c.COMPLETED / total) * 10000))) : 0;
  return { total, completed: c.COMPLETED, inProgress: c.IN_PROGRESS, available: c.AVAILABLE, blocked: c.BLOCKED, unavailable: c.UNAVAILABLE, progressBp };
}

/** Next executable item (§19): earliest IN_PROGRESS, else earliest AVAILABLE, else null. Items sorted by position. */
export function nextItemId(items: DerivedItem[]): string | null {
  const inProgress = items.find((i) => i.state === 'IN_PROGRESS');
  if (inProgress) return inProgress.roadmapItemId;
  const available = items.find((i) => i.state === 'AVAILABLE');
  return available ? available.roadmapItemId : null;
}
