import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { LearningCoreModule } from '../learning-core/learning-core.module';
import { DailyLearningController } from './daily-learning.controller';
import { DailyLearningService } from './daily-learning.service';
import { DailyLearningRepository } from './daily-learning.repository';

/**
 * V2 Daily Learning — the "what should I do today" orchestration. Imports LearningCoreModule to REUSE the V2
 * roadmap projection (attention/availability/acquisition already derived there) rather than re-deriving any
 * scoring/mastery/adaptation. PrismaService is global. No reward/evidence writes here.
 */
@Module({
  imports: [ClockModule, LearningCoreModule],
  controllers: [DailyLearningController],
  providers: [DailyLearningService, DailyLearningRepository],
  exports: [DailyLearningService],
})
export class DailyLearningModule {}
