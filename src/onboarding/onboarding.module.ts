import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { OnboardingContentRepository } from './onboarding-content.repository';
import { LearningIntentRepository } from './learning-intent.repository';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  imports: [ProfileModule], // ProfileRepository (onboarding holati/complete)
  controllers: [OnboardingController],
  providers: [OnboardingContentRepository, LearningIntentRepository, OnboardingService],
  exports: [LearningIntentRepository], // Phase 1.5B: placement entry intent lookup (AssessmentModule)
})
export class OnboardingModule {}
