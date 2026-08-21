import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { SkillProfileService } from './skill-profile.service';

/**
 * Skill Profile API (Phase 1.5C). Global AuthGuard → authenticated; every operation scoped to
 * principal.userId (own learning state only, §39). No client-supplied scores (§40); no PATCH.
 */
@Controller('skill-profile')
export class SkillProfileController {
  constructor(private readonly skillProfile: SkillProfileService) {}

  /** Current Skill Profile (LearnerSkillState) for the learner + subject. */
  @Get('me/subjects/:subjectId')
  currentProfile(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.skillProfile.getCurrentProfile(principal.userId, subjectId);
  }

  /** The diagnostic milestone snapshot produced by one owned completed attempt. */
  @Get('diagnostics/:attemptId')
  diagnosticSnapshot(@CurrentPrincipal() principal: AuthPrincipal, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.skillProfile.getDiagnosticSnapshot(principal.userId, attemptId);
  }

  /** Idempotent repair/backfill: (re)derive the profile for an owned completed diagnostic (§30). */
  @Post('diagnostics/:attemptId/derive')
  @HttpCode(200)
  async derive(@CurrentPrincipal() principal: AuthPrincipal, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    await this.skillProfile.ensureDiagnosticDerived(principal.userId, attemptId);
    return this.skillProfile.getDiagnosticSnapshot(principal.userId, attemptId);
  }
}
