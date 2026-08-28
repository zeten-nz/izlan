import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { PlacementV2Service } from './placement-v2.service';
import { FromZeroDto } from './dto/from-zero.dto';

/**
 * Placement V2 API. Global AuthGuard → authenticated; own-user only (all reads/writes scoped by userId, 404-safe).
 * Two entry paths: NEW learner (from-zero, no diagnostic) and experienced learner (finalize from a completed
 * diagnostic). Both produce an immutable PlacementDecision and a personalized V2 roadmap generation.
 */
@Controller('v2/placement')
export class PlacementV2Controller {
  constructor(private readonly placement: PlacementV2Service) {}

  /** NEW learner "starting from zero" — creates a FRESH_START decision + full available progression. */
  @Post('subjects/:subjectId/from-zero')
  @HttpCode(200)
  fromZero(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string, @Body() dto: FromZeroDto) {
    return this.placement.startFromZero(principal.userId, subjectId, dto.clientRequestId);
  }

  /** Experienced learner — finalize placement from a completed diagnostic attempt (validated/weak/gap profile). */
  @Post('diagnostics/:attemptId/finalize')
  @HttpCode(200)
  finalize(@CurrentPrincipal() principal: AuthPrincipal, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.placement.finalizeFromDiagnostic(principal.userId, attemptId);
  }

  /** The learner's latest placement decision result (immutable decision-time snapshot). */
  @Get('me/subjects/:subjectId')
  getResult(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.placement.getResult(principal.userId, subjectId);
  }
}
