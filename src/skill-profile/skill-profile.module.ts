import { Module } from '@nestjs/common';
import { SkillProfileController } from './skill-profile.controller';
import { SkillProfileService } from './skill-profile.service';
import { SkillProfileRepository } from './skill-profile.repository';
import { DiagnosticSkillProfileEngine } from './derivation/diagnostic-profile.engine';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';

/**
 * Skill Profile derivation (Phase 1.5C). Reads assessment evidence tables directly (via PrismaService)
 * and reuses assessment's pure config parser + types by FILE import only — no Nest import of
 * AssessmentModule, so AssessmentModule → SkillProfileModule stays a clean one-way dependency (§28).
 * Imports LearningProgressModule to delegate LearnerSkillState materialization to the single writer (TD-115).
 */
@Module({
  imports: [LearningProgressModule],
  controllers: [SkillProfileController],
  providers: [SkillProfileService, SkillProfileRepository, DiagnosticSkillProfileEngine],
  exports: [SkillProfileService],
})
export class SkillProfileModule {}
