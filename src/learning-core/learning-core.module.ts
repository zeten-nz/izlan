import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { LearnerSignalsModule } from '../learner-signals/learner-signals.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { ReviewSessionModule } from '../review-session/review-session.module';
import { DailyMissionModule } from '../daily-mission/daily-mission.module';
import { ObjectiveActivityScorerService } from '../lesson-execution/activity/objective-activity-scorer.service';
import { LearningCoreRepository } from './learning-core.repository';
import { V2RoadmapService } from './v2-roadmap.service';
import { V2RoadmapController } from './v2-roadmap.controller';
import { TeachingSessionService } from './teaching-session.service';
import { TeachingSessionController } from './teaching-session.controller';
import { AdaptationService } from './adaptation.service';
import { AdaptationController } from './adaptation.controller';

/**
 * V2 Learning Core (Wave B–D runtime). The learner-facing vertical slice: a V2 roadmap generation/projection
 * read, and the TeachingSession lifecycle (start/resume → objective attempts → evidence lineage → mastery
 * evaluation → LEARNED acquisition). Imports LearningProgressModule so mastery recompute goes through the ONE
 * writer of LearnerSkillState. Reuses the V1 ObjectiveActivityScorerService (stateless) for server-side scoring.
 */
@Module({
  imports: [LearningProgressModule, ClockModule, LearnerSignalsModule, ReviewSessionModule, DailyMissionModule],
  controllers: [V2RoadmapController, TeachingSessionController, AdaptationController],
  providers: [LearningCoreRepository, V2RoadmapService, TeachingSessionService, ObjectiveActivityScorerService, AdaptationService],
  exports: [V2RoadmapService, TeachingSessionService],
})
export class LearningCoreModule {}
