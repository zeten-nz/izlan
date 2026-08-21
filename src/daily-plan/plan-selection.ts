/**
 * Pure daily-plan item selection (daily-plan-roadmap-v1, TD-103/104/105). Consumes the accepted
 * Phase 1.6B roadmap read model — it does NOT re-derive gap/prerequisite/completion logic (§4/5/27).
 *
 * One Topic per day (§4): the Topic is the one containing the roadmap `nextItem`. Exactly one MUST_DO
 * (= nextItem); RECOMMENDED = later, unfinished, same-Topic roadmap items in position order (§14/15).
 * No EXTRA auto-generation (§18). No workload cap (§19).
 */
export const DAILY_PLAN_ENGINE_VERSION = 'daily-plan-roadmap-v1';

export interface RoadmapItemView {
  id: string; // roadmapItemId
  position: number;
  state: string; // COMPLETED | UNAVAILABLE | IN_PROGRESS | BLOCKED | AVAILABLE
  skillId: string | null;
  lesson: { id: string | null; title: string | null };
}

export type PlanSection = 'MUST_DO' | 'RECOMMENDED';

export interface PlanItemPlan {
  section: PlanSection;
  roadmapItemId: string;
  lessonId: string;
  skillId: string | null;
  position: number; // 1 = MUST_DO, then RECOMMENDED in roadmap-position order
}

/**
 * Build the ordered plan items from the roadmap read model. Returns null when there is no executable
 * next item (no MUST_DO) — the caller then refuses to create an empty plan (§14/21/22).
 * `topicOf` maps a lessonId → its Topic id.
 */
export function selectPlanItems(items: RoadmapItemView[], nextItemId: string | null, topicOf: ReadonlyMap<string, string>): { topicId: string; planItems: PlanItemPlan[] } | null {
  if (!nextItemId) return null;
  const mustDo = items.find((i) => i.id === nextItemId);
  if (!mustDo || !mustDo.lesson.id) return null;
  const topicId = topicOf.get(mustDo.lesson.id);
  if (!topicId) return null; // cannot resolve the day's Topic

  const recommended = items
    .filter(
      (i) =>
        i.id !== mustDo.id &&
        i.position > mustDo.position &&
        i.lesson.id !== null &&
        i.state !== 'COMPLETED' && // exclude already-finished (§45)
        i.state !== 'UNAVAILABLE' && // exclude non-visible content
        topicOf.get(i.lesson.id) === topicId, // SAME Topic only (§17/20)
    )
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

  const ordered = [mustDo, ...recommended];
  const planItems: PlanItemPlan[] = ordered.map((i, idx) => ({
    section: idx === 0 ? 'MUST_DO' : 'RECOMMENDED',
    roadmapItemId: i.id,
    lessonId: i.lesson.id!,
    skillId: i.skillId,
    position: idx + 1,
  }));
  return { topicId, planItems };
}
