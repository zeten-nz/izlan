import { Injectable } from '@nestjs/common';
import { DailyPlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class DailyLearningRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Learner-local timezone (IANA) from the profile; null → the daily plan cannot resolve "today". */
  async timezone(userId: string): Promise<string | null> {
    const p = await this.prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
    return p?.timezone ?? null;
  }

  /** The learner's primary subject for the daily home: the first intent with a track, else the first intent. */
  async primarySubjectId(userId: string): Promise<string | null> {
    const withTrack = await this.prisma.learnerLearningIntent.findFirst({ where: { userId, trackId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { subjectId: true } });
    if (withTrack) return withTrack.subjectId;
    const any = await this.prisma.learnerLearningIntent.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { subjectId: true } });
    return any?.subjectId ?? null;
  }

  async subjectTitle(subjectId: string): Promise<string | null> {
    const s = await this.prisma.subject.findUnique({ where: { id: subjectId }, select: { title: true } });
    return s?.title ?? null;
  }

  findCurrentPlan(userId: string, subjectId: string, localDate: Date) {
    return this.prisma.dailyLearningPlan.findFirst({ where: { userId, subjectId, localDate, status: DailyPlanStatus.CURRENT } });
  }

  async nextGenerationNo(userId: string, subjectId: string, localDate: Date): Promise<number> {
    const row = await this.prisma.dailyLearningPlan.aggregate({ where: { userId, subjectId, localDate }, _max: { generationNo: true } });
    return (row._max.generationNo ?? 0) + 1;
  }

  createPlan(data: { userId: string; subjectId: string; localDate: Date; timezoneSnapshot: string; generationNo: number; policyVersion: string; engineVersion: string; mainRoadmapPointId: string | null; decision: Prisma.InputJsonValue }) {
    return this.prisma.dailyLearningPlan.create({ data });
  }
}
