import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { LearnerSignalsModule } from '../learner-signals/learner-signals.module';
import { DailyMissionModule } from '../daily-mission/daily-mission.module';
import { ObjectiveActivityScorerService } from '../lesson-execution/activity/objective-activity-scorer.service';
import { ReviewSessionController } from './review-session.controller';
import { ReviewSessionService } from './review-session.service';
import { ReviewSessionRepository } from './review-session.repository';
import { ReviewMasteryService } from './review-mastery.service';

/**
 * Review Session execution (Phase 1.9B-2 + 1.9C mastery). Imports ReviewModule (read-only candidate
 * revalidation), LearningProgressModule (single-writer state recompute via merge-v2), LearnerSignalsModule
 * (signal evaluation) — one-way. Review writes only its aggregates + review-provenance ActivityAttempts +
 * REVIEW_MASTERY SkillMeasurement.
 */
@Module({
  imports: [ReviewModule, LearningProgressModule, LearnerSignalsModule, DailyMissionModule],
  controllers: [ReviewSessionController],
  providers: [ReviewSessionService, ReviewSessionRepository, ObjectiveActivityScorerService, ReviewMasteryService],
})
export class ReviewSessionModule {}
