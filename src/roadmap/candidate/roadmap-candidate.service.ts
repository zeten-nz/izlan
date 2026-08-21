import { Injectable } from '@nestjs/common';
import { RankedGap } from '../gap/gap-ranking.types';
import { RoadmapItemPlan, RoadmapRepository } from '../roadmap.repository';
import { OwnerPriority, computeReachableClosure, effectivePriorities, priorityTopoOrder } from './prerequisite-ordering';

/**
 * Deterministic candidate selection over human-approved published content (§9-18). For each ranked
 * gap Skill: explicitly-mapped (LessonSkill), learner-visible, not-completed Lessons → prerequisite
 * closure → dedup → priority-aware topological order. No AI, no title/keyword inference.
 */
@Injectable()
export class RoadmapCandidateService {
  constructor(private readonly repo: RoadmapRepository) {}

  async computePlan(userId: string, rankedGaps: RankedGap[]): Promise<{ plan: RoadmapItemPlan[]; uncoveredSkillIds: string[] }> {
    const gapSkillIds = rankedGaps.map((g) => g.skillId);
    const priorityOf = new Map(rankedGaps.map((g) => [g.skillId, g.gapPriorityBp]));

    const mapped = await this.repo.mappedLessons(gapSkillIds); // explicit Skill→Lesson mapping only (§11)
    if (mapped.length === 0) return { plan: [], uncoveredSkillIds: [...gapSkillIds].sort() };

    const completed = await this.repo.completedLessonIds(userId);

    // Transitive prerequisite closure over the mapped lessons.
    const universe = new Set(mapped.map((m) => m.lessonId));
    const prereqOf = new Map<string, string[]>();
    let frontier = [...universe];
    while (frontier.length > 0) {
      const edges = await this.repo.prerequisiteEdges(frontier);
      const next: string[] = [];
      for (const e of edges) {
        const arr = prereqOf.get(e.lessonId) ?? prereqOf.set(e.lessonId, []).get(e.lessonId)!;
        if (!arr.includes(e.prerequisiteLessonId)) arr.push(e.prerequisiteLessonId);
        if (!universe.has(e.prerequisiteLessonId)) {
          universe.add(e.prerequisiteLessonId);
          next.push(e.prerequisiteLessonId);
        }
      }
      frontier = next;
    }

    const meta = await this.repo.lessonMeta([...universe]);
    const includable = new Set<string>();
    for (const [lessonId, m] of meta) if (m.eligible && !completed.has(lessonId)) includable.add(lessonId); // §9/12

    const seeds = new Set<string>();
    for (const m of mapped) if (includable.has(m.lessonId)) seeds.add(m.lessonId);

    const { reachable } = computeReachableClosure([...seeds], prereqOf, completed, includable); // throws on cycle (§15)

    // Direct priority per reachable directly-mapped lesson (max gap; tie → smaller skillId).
    const direct = new Map<string, OwnerPriority>();
    for (const m of mapped) {
      if (!reachable.has(m.lessonId)) continue;
      const bp = priorityOf.get(m.skillId)!;
      const cur = direct.get(m.lessonId);
      if (!cur || bp > cur.bp || (bp === cur.bp && m.skillId < cur.skillId)) direct.set(m.lessonId, { bp, skillId: m.skillId });
    }

    const effective = effectivePriorities(reachable, direct, prereqOf); // prereqs inherit dependent priority (§14)
    const items = [...reachable].map((lessonId) => ({
      lessonId,
      priorityBp: effective.get(lessonId)!.bp,
      topicSortOrder: meta.get(lessonId)!.topicSortOrder,
      lessonSortOrder: meta.get(lessonId)!.lessonSortOrder,
    }));
    const order = priorityTopoOrder(items, prereqOf); // deterministic; throws on cycle (§16/29)
    const plan = order.map((lessonId, idx) => ({ lessonId, skillId: effective.get(lessonId)!.skillId, position: idx + 1 }));

    // A gap Skill is covered iff it has a reachable directly-mapped lesson (§19/48).
    const covered = new Set<string>();
    for (const m of mapped) if (reachable.has(m.lessonId)) covered.add(m.skillId);
    const uncoveredSkillIds = gapSkillIds.filter((s) => !covered.has(s)).sort();

    return { plan, uncoveredSkillIds };
  }
}
