import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { LearnerSignalsController } from './learner-signals.controller';
import { LearnerSignalsService } from './learner-signals.service';
import { LearnerSignalsRepository } from './learner-signals.repository';

/**
 * Learner Signals (Phase 1.8B/1.8C). The ONLY writer of LearnerSignal (advisory) — REPEATED_MISTAKE (attempt
 * evidence), WEAK_SKILL + REVIEW_DUE (current LearnerSkillState + Clock). Reads via its own repository; other
 * domains (LessonExecution, LearningProgress) import it to request evaluation — one-way, no cycle. Does NOT own
 * skill state (that is LearningProgress).
 */
@Module({
  imports: [ClockModule],
  controllers: [LearnerSignalsController],
  providers: [LearnerSignalsService, LearnerSignalsRepository],
  exports: [LearnerSignalsService],
})
export class LearnerSignalsModule {}
