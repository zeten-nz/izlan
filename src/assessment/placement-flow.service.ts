import { Injectable, Logger } from '@nestjs/common';
import { AssessmentService, AttemptView } from './assessment.service';
import { SkillProfileService } from '../skill-profile/skill-profile.service';

/**
 * Placement submission workflow (§28). Coordinates the two domains one-way: AssessmentService stays
 * evidence-only; when an attempt completes, the Skill Profile is derived synchronously here.
 *
 * Failure semantics (§29): the assessment completion is already committed by submitResponse. If
 * derivation fails, we do NOT roll back or mutate the completed attempt — we log and return the
 * attempt view. The derivation is fully idempotent, so a retry (client resubmit → COMPLETED replay,
 * or the repair endpoint) recovers without losing evidence.
 */
@Injectable()
export class PlacementFlowService {
  private readonly logger = new Logger('PlacementFlow');

  constructor(
    private readonly assessment: AssessmentService,
    private readonly skillProfile: SkillProfileService,
  ) {}

  async submitResponse(userId: string, attemptId: string, itemId: string, answer: Record<string, unknown>): Promise<AttemptView> {
    const view = await this.assessment.submitResponse(userId, attemptId, itemId, answer);
    if (view.status === 'COMPLETED') {
      try {
        await this.skillProfile.ensureDiagnosticDerived(userId, attemptId);
      } catch {
        // Assessment evidence is safe; derivation is recoverable (idempotent). Log a safe id only.
        this.logger.warn(`diagnostic derivation deferred for attempt ${attemptId}`);
      }
    }
    return view;
  }
}
