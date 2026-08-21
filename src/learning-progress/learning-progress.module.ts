import { Module } from '@nestjs/common';
import { LearnerSignalsModule } from '../learner-signals/learner-signals.module';
import { LearningProgressController } from './learning-progress.controller';
import { LearningProgressService } from './learning-progress.service';
import { LearningProgressRepository } from './learning-progress.repository';

/**
 * Learning Progress Merge (Phase 1.8A). Owns the ONLY writer of LearnerSkillState (TD-115). Reads
 * SkillMeasurement/LearnerSkillState via its own repository. Imports LearnerSignalsModule to fire the
 * downstream advisory state-signal evaluation AFTER a state recompute (1.8C §29/30) — one-way (Signals never
 * imports LearningProgress), and the pure merge engine stays signal-unaware.
 */
@Module({
  imports: [LearnerSignalsModule],
  controllers: [LearningProgressController],
  providers: [LearningProgressService, LearningProgressRepository],
  exports: [LearningProgressService],
})
export class LearningProgressModule {}
