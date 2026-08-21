import { Injectable } from '@nestjs/common';
import { DailyPlanItemType, DailyPlanSection, DailyPlanStatus, Prisma, RoadmapStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface PlanItemRow {
  section: DailyPlanSection;
  itemType: DailyPlanItemType; // LESSON (roadmap core) | REVIEW (optional EXTRA, Phase 2.0A)
  roadmapItemId: string | null; // NULL for a review EXTRA (not roadmap-backed, §2/20)
  lessonId: string;
  skillId: string | null;
  position: number;
}

const PLAN_VIEW = {
  id: true,
  localDate: true,
  timezoneSnapshot: true,
  generationNo: true,
  status: true,
  items: {
    orderBy: { position: 'asc' },
    select: { id: true, section: true, itemType: true, roadmapItemId: true, lessonId: true, skillId: true, position: true },
  },
} satisfies Prisma.DailyPlanSelect;

/**
 * Daily-plan-specific persistence. Progress batch loads (completion/progress/visibility/prerequisites)
 * are reused from RoadmapRepository (read service) — not duplicated here.
 */
@Injectable()
export class DailyPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The CURRENT plan for a learner's local day (one-CURRENT DB invariant ux_current_daily_plan, L16). */
  findCurrentPlan(userId: string, localDate: Date) {
    return this.prisma.dailyPlan.findFirst({ where: { userId, localDate, status: DailyPlanStatus.CURRENT }, select: PLAN_VIEW });
  }

  findPlanById(id: string) {
    return this.prisma.dailyPlan.findUnique({ where: { id }, select: PLAN_VIEW });
  }

  /** The learner's ACTIVE roadmaps, earliest first — the daily plan's roadmap source (§4/21). */
  activeRoadmaps(userId: string) {
    return this.prisma.learnerRoadmap.findMany({
      where: { userId, status: RoadmapStatus.ACTIVE },
      orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, subjectId: true },
    });
  }

  /** lessonId → its Topic (for Topic selection + same-Topic filter, §4/17/20). */
  async lessonTopics(lessonIds: string[]): Promise<Map<string, { topicId: string; topicTitle: string }>> {
    const rows = await this.prisma.lesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, topic: { select: { id: true, title: true } } } });
    return new Map(rows.map((r) => [r.id, { topicId: r.topic.id, topicTitle: r.topic.title }]));
  }

  /** skillId → name (review EXTRA projection, Phase 2.0A). */
  async skillsByIds(skillIds: string[]): Promise<Map<string, string>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Next generationNo for (user, localDate) — max+1 (1 for the first plan of the day, §31). */
  async nextGenerationNo(userId: string, localDate: Date): Promise<number> {
    const max = await this.prisma.dailyPlan.aggregate({ where: { userId, localDate }, _max: { generationNo: true } });
    return (max._max.generationNo ?? 0) + 1;
  }

  /** Atomic header + items (§58). ux_current_daily_plan is the concurrency authority (caller catches P2002). */
  async createPlan(header: { userId: string; localDate: Date; timezoneSnapshot: string; generationNo: number }, items: PlanItemRow[]): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.dailyPlan.create({
        data: {
          userId: header.userId,
          localDate: header.localDate,
          timezoneSnapshot: header.timezoneSnapshot,
          generationNo: header.generationNo,
          status: DailyPlanStatus.CURRENT,
        },
        select: { id: true },
      });
      await tx.dailyPlanItem.createMany({
        data: items.map((i) => ({
          dailyPlanId: plan.id,
          section: i.section,
          itemType: i.itemType,
          roadmapItemId: i.roadmapItemId,
          lessonId: i.lessonId,
          skillId: i.skillId,
          position: i.position,
        })),
      });
      return plan.id;
    });
  }
}
