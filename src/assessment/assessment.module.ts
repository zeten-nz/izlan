import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SkillProfileModule } from '../skill-profile/skill-profile.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { PlacementFlowService } from './placement-flow.service';
import { AssessmentDefinitionRepository } from './repositories/assessment-definition.repository';
import { AssessmentItemRepository } from './repositories/assessment-item.repository';
import { AssessmentAttemptRepository } from './repositories/assessment-attempt.repository';
import { PlacementEngineService } from './engine/placement-engine.service';
import { ObjectiveScorerService } from './scoring/objective-scorer.service';

/**
 * Placement (initial DIAGNOSTIC) assessment (Phase 1.5B). AssessmentService is evidence-only (§40);
 * PlacementFlowService orchestrates completion → Skill Profile derivation (one-way import of
 * SkillProfileModule, Phase 1.5C §28). Reuses ProfileRepository + LearningIntentRepository.
 */
@Module({
  imports: [ProfileModule, OnboardingModule, SkillProfileModule],
  controllers: [AssessmentController],
  providers: [
    AssessmentService,
    PlacementFlowService,
    AssessmentDefinitionRepository,
    AssessmentItemRepository,
    AssessmentAttemptRepository,
    PlacementEngineService,
    ObjectiveScorerService,
  ],
})
export class AssessmentModule {}
