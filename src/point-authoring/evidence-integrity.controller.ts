import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { CONTENT_PUBLISH } from '../content-authoring/content-authoring.constants';
import { EvidenceIntegrityService } from './evidence-integrity.service';
import { RecordIntegrityDecisionDto } from './dto/point-authoring.dto';

/**
 * Evidence Integrity API. Recording a scoped integrity decision is a governance action gated by content.publish
 * plus the actor's SubjectAssignment (resolved from the scoped artifact). Base `/api/staff/content/v2`.
 */
@Controller('staff/content/v2')
export class EvidenceIntegrityController {
  constructor(private readonly svc: EvidenceIntegrityService) {}

  @Post('evidence-integrity/decisions')
  @RequirePermissions(CONTENT_PUBLISH)
  @HttpCode(200)
  record(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: RecordIntegrityDecisionDto) {
    return this.svc.recordDecision(p.userId, dto);
  }
}
