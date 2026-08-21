import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { ProfileModule } from '../profile/profile.module';
import { RoadmapModule } from '../roadmap/roadmap.module';
import { ReviewModule } from '../review/review.module';
import { DailyPlanController } from './daily-plan.controller';
import { DailyPlanService } from './daily-plan.service';
import { DailyPlanReadService } from './daily-plan-read.service';
import { DailyPlanRepository } from './daily-plan.repository';

/**
 * Daily Plan Foundation (Phase 1.7A + 2.0A review EXTRA). One-way deps: RoadmapModule (next-item/Topic + progress),
 * ProfileModule (timezone), ReviewModule (read-only ReviewCandidate authority for the optional review EXTRA).
 * Reuses the pure roadmap-progress state machine by file import — no duplicated logic, no cycle.
 */
@Module({
  imports: [ProfileModule, RoadmapModule, ClockModule, ReviewModule],
  controllers: [DailyPlanController],
  providers: [DailyPlanService, DailyPlanReadService, DailyPlanRepository],
})
export class DailyPlanModule {}
