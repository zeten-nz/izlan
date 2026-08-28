import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PlacementV2Module } from '../placement-v2/placement-v2.module';
import { LearningCoreModule } from '../learning-core/learning-core.module';
import { LearnerController } from './learner.controller';
import { LearnerHomeService } from './learner.service';

/**
 * LearnerModule — the first-run/landing read-model. Imports the engine modules it composes (Onboarding, Placement,
 * Learning Core roadmap) and reuses their exported services; it adds no engine of its own and performs no writes.
 */
@Module({
  imports: [OnboardingModule, PlacementV2Module, LearningCoreModule],
  controllers: [LearnerController],
  providers: [LearnerHomeService],
  exports: [LearnerHomeService],
})
export class LearnerModule {}
