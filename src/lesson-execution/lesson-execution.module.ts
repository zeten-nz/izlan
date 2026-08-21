import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { ProfileModule } from '../profile/profile.module';
import { RoadmapModule } from '../roadmap/roadmap.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { LearnerSignalsModule } from '../learner-signals/learner-signals.module';
import { DailyMissionModule } from '../daily-mission/daily-mission.module';
import { LessonExecutionController } from './lesson-execution.controller';
import { LessonExecutionService } from './lesson-execution.service';
import { LessonExecutionRepository } from './lesson-execution.repository';
import { ActivityAttemptRepository } from './activity/activity-attempt.repository';
import { ObjectiveActivityScorerService } from './activity/objective-activity-scorer.service';
import { LessonCompletionService } from './completion/lesson-completion.service';
import { LessonCompletionRepository } from './completion/lesson-completion.repository';

/**
 * Lesson Execution Foundation (Phase 1.7B). Reuses RoadmapRepository (progress batch loads) + the pure
 * roadmap-progress state machine (file import) for live executability, ProfileModule (timezone), and the
 * shared Clock — one-way deps, no cycle. Activity submission/scoring deferred (owner review).
 */
@Module({
  imports: [ProfileModule, RoadmapModule, ClockModule, LearningProgressModule, LearnerSignalsModule, DailyMissionModule],
  controllers: [LessonExecutionController],
  providers: [LessonExecutionService, LessonExecutionRepository, ActivityAttemptRepository, ObjectiveActivityScorerService, LessonCompletionService, LessonCompletionRepository],
})
export class LessonExecutionModule {}
