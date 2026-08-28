import { Module } from '@nestjs/common';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { ObjectiveActivityScorerService } from '../lesson-execution/activity/objective-activity-scorer.service';
import { LearningCoreRepository } from './learning-core.repository';
import { V2RoadmapService } from './v2-roadmap.service';
import { V2RoadmapController } from './v2-roadmap.controller';
import { TeachingSessionService } from './teaching-session.service';
import { TeachingSessionController } from './teaching-session.controller';

/**
 * V2 Learning Core (Wave B–D runtime). The learner-facing vertical slice: a V2 roadmap generation/projection
 * read, and the TeachingSession lifecycle (start/resume → objective attempts → evidence lineage → mastery
 * evaluation → LEARNED acquisition). Imports LearningProgressModule so mastery recompute goes through the ONE
 * writer of LearnerSkillState. Reuses the V1 ObjectiveActivityScorerService (stateless) for server-side scoring.
 */
@Module({
  imports: [LearningProgressModule],
  controllers: [V2RoadmapController, TeachingSessionController],
  providers: [LearningCoreRepository, V2RoadmapService, TeachingSessionService, ObjectiveActivityScorerService],
  exports: [V2RoadmapService, TeachingSessionService],
})
export class LearningCoreModule {}
