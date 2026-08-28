import { Module } from '@nestjs/common';
import { ContentAuthoringModule } from '../content-authoring/content-authoring.module';
import { LearningProgressModule } from '../learning-progress/learning-progress.module';
import { PointAuthoringController } from './point-authoring.controller';
import { PointAuthoringService } from './point-authoring.service';
import { PointAuthoringRepository } from './point-authoring.repository';
import { PointReadinessService } from './point-readiness.service';
import { EvidenceIntegrityService } from './evidence-integrity.service';
import { EvidenceIntegrityController } from './evidence-integrity.controller';

/**
 * V2 Content Studio — Roadmap Point authoring + quality gate. Imports ContentAuthoringModule to REUSE the V1
 * substrate (SubjectScopeService for two-dimension authz, ContentAuditRepository for co-committed audit) rather
 * than forking a parallel authorization/audit path.
 */
@Module({
  imports: [ContentAuthoringModule, LearningProgressModule],
  controllers: [PointAuthoringController, EvidenceIntegrityController],
  providers: [PointAuthoringService, PointAuthoringRepository, PointReadinessService, EvidenceIntegrityService],
  exports: [PointAuthoringService],
})
export class PointAuthoringModule {}
