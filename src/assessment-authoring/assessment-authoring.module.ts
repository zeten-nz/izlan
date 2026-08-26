import { Module } from '@nestjs/common';
import { ContentAuthoringModule } from '../content-authoring/content-authoring.module';
import { AssessmentAuthoringController } from './assessment-authoring.controller';
import { AssessmentAuthoringService } from './assessment-authoring.service';
import { AssessmentAuthoringRepository } from './assessment-authoring.repository';
import { AssessmentReadinessService } from './assessment-readiness.service';
import './assessment-authoring.constants'; // side-effect: register assessment.author / assessment.publish

/**
 * AssessmentAuthoringModule (V1 — staff diagnostic/placement authoring). Reuses the content-authoring authority
 * (SubjectScopeService + ContentAuditRepository, exported by ContentAuthoringModule). Global AuthGuard/PermissionsGuard
 * protect the controller; PrismaService is global. The learner runtime AssessmentModule is NOT imported or modified.
 */
@Module({
  imports: [ContentAuthoringModule],
  controllers: [AssessmentAuthoringController],
  providers: [AssessmentAuthoringService, AssessmentAuthoringRepository, AssessmentReadinessService],
})
export class AssessmentAuthoringModule {}
