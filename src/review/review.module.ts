import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { ReviewRepository } from './review.repository';

/**
 * Review Candidates (Phase 1.9A). A READ-ONLY derived module: reads ACTIVE signals + curriculum/exposure via
 * its own repository and reuses the strict repeated-mistake evidenceRefs parser (file import). Owns no signal
 * lifecycle (LearnerSignals does) and writes nothing. No dependency on Roadmap/DailyPlan/LessonExecution.
 */
@Module({
  controllers: [ReviewController],
  providers: [ReviewService, ReviewRepository],
  exports: [ReviewService], // ReviewSession start reuses assertCandidateAvailable (read-only) — one-way, no cycle
})
export class ReviewModule {}
