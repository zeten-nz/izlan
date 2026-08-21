import { Module } from '@nestjs/common';
import { RoadmapController } from './roadmap.controller';
import { RoadmapService } from './roadmap.service';
import { RoadmapRepository } from './roadmap.repository';
import { RoadmapCandidateService } from './candidate/roadmap-candidate.service';
import { GapRankingEngine } from './gap/gap-ranking.engine';
import { RoadmapReadService } from './read/roadmap-read.service';

/**
 * Roadmap Foundation (Phase 1.6A). Reads assessment/skill-profile/content evidence via its own
 * repository (PrismaService) — no Nest import of those modules — and reuses the pure diagnostic
 * derivation-version constant by file import only. Standalone: nothing imports it back.
 */
@Module({
  controllers: [RoadmapController],
  providers: [RoadmapService, RoadmapReadService, RoadmapRepository, RoadmapCandidateService, GapRankingEngine],
  exports: [RoadmapReadService, RoadmapRepository, RoadmapService], // reused by DailyPlan (1.7A) + LessonExecution reconcile (1.7C), one-way
})
export class RoadmapModule {}
