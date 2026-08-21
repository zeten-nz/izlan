import { Injectable } from '@nestjs/common';
import { RoadmapRepository } from '../roadmap/roadmap.repository';
import { ProgressContext, RoadmapItemState, deriveItemState } from '../roadmap/read/roadmap-progress';
import { DailyPlanRepository } from './daily-plan.repository';
import { formatDateOnly } from './local-date.util';

type PlanRow = NonNullable<Awaited<ReturnType<DailyPlanRepository['findCurrentPlan']>>>;

export interface DailyPlanView {
  id: string;
  localDate: string;
  timezone: string;
  generationNo: number;
  status: string;
  topic: { id: string; title: string } | null;
  done: boolean;
  progress: { total: number; completed: number; progressBp: number };
  items: {
    id: string;
    kind: string; // section: MUST_DO | RECOMMENDED | EXTRA
    itemType: string; // LESSON | REVIEW
    position: number;
    state: RoadmapItemState | null; // null for a review EXTRA (not a roadmap-state concept, §26)
    lesson: { id: string | null; title: string | null };
    skill?: { id: string; name: string | null }; // review EXTRA target Skill
  }[];
}

/**
 * Daily plan read projector. Item membership/priority is the immutable snapshot; each item's executability
 * is DERIVED live (§26) by reusing the Phase 1.6B roadmap-progress state machine (pure `deriveItemState`) and
 * RoadmapRepository batch loads — no duplicated state logic (§27), read-only, O(few) queries (§69).
 */
@Injectable()
export class DailyPlanReadService {
  constructor(
    private readonly repo: DailyPlanRepository,
    private readonly roadmapRepo: RoadmapRepository,
  ) {}

  async project(userId: string, plan: PlanRow): Promise<DailyPlanView> {
    const items = [...plan.items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
    const coreItems = items.filter((i) => i.section !== 'EXTRA'); // roadmap-backed core (§27/59)
    const lessonIds = items.map((i) => i.lessonId).filter((x): x is string => x !== null);
    const extraSkillIds = items.filter((i) => i.section === 'EXTRA' && i.skillId).map((i) => i.skillId as string);

    const [completed, inProgress, meta, skillNames] = await Promise.all([
      this.roadmapRepo.completedLessonIds(userId),
      this.roadmapRepo.inProgressLessonIds(userId),
      this.roadmapRepo.lessonMeta(lessonIds),
      this.repo.skillsByIds(extraSkillIds),
    ]);
    const edges = await this.roadmapRepo.prerequisiteEdges(lessonIds);
    const topics = await this.repo.lessonTopics(lessonIds);

    const prereqOf = new Map<string, string[]>();
    for (const e of edges) (prereqOf.get(e.lessonId) ?? prereqOf.set(e.lessonId, []).get(e.lessonId)!).push(e.prerequisiteLessonId);
    const available = new Set<string>();
    for (const [lid, m] of meta) if (m.eligible) available.add(lid);
    const ctx: ProgressContext = { completed, inProgress, available, prereqOf };

    // Core completion/progress = roadmap-backed core items ONLY; the optional review EXTRA never affects it (§27/59).
    const coreDerived = coreItems.map((i) => deriveItemState(i.lessonId, ctx));
    const total = coreDerived.length;
    const completedCount = coreDerived.filter((state) => state === 'COMPLETED').length;
    const progressBp = total > 0 ? Math.max(0, Math.min(10000, Math.round((completedCount / total) * 10000))) : 0;
    const done = total > 0 && completedCount === total;

    // The plan is one Topic — take it from the MUST_DO lesson (core position 1).
    const coreLessonId = coreItems[0]?.lessonId ?? null;
    const topicEntry = coreLessonId ? topics.get(coreLessonId) : undefined;

    return {
      id: plan.id,
      localDate: formatDateOnly(plan.localDate),
      timezone: plan.timezoneSnapshot,
      generationNo: plan.generationNo,
      status: plan.status,
      topic: topicEntry ? { id: topicEntry.topicId, title: topicEntry.topicTitle } : null,
      done,
      progress: { total, completed: completedCount, progressBp },
      items: items.map((item) => ({
        id: item.id,
        kind: item.section,
        itemType: item.itemType,
        position: item.position,
        state: item.section === 'EXTRA' ? null : deriveItemState(item.lessonId, ctx), // §26 no roadmap state for review EXTRA
        lesson: { id: item.lessonId, title: item.lessonId ? meta.get(item.lessonId)?.title ?? null : null },
        ...(item.section === 'EXTRA' && item.skillId ? { skill: { id: item.skillId, name: skillNames.get(item.skillId) ?? null } } : {}),
      })),
    };
  }
}
