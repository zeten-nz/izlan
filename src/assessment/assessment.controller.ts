import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { AssessmentService } from './assessment.service';
import { PlacementFlowService } from './placement-flow.service';
import { StartPlacementDto } from './dto/start-placement.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';

/**
 * Placement (initial diagnostic) assessment API (§43/45). Global AuthGuard → authenticated;
 * every operation is scoped to principal.userId (own attempts only, §12). No methodist/authoring
 * routes here (§40/41) and no learner permission beyond authentication.
 */
@Controller('assessments')
export class AssessmentController {
  constructor(
    private readonly assessment: AssessmentService,
    private readonly flow: PlacementFlowService,
  ) {}

  /** Non-leaky availability probe (§44) — { available } only, never why. */
  @Get('placement/availability')
  availability(@CurrentPrincipal() principal: AuthPrincipal, @Query('learningIntentId', ParseUUIDPipe) learningIntentId: string) {
    return this.assessment.availability(principal.userId, learningIntentId);
  }

  /** Start (or resume an in-progress) placement attempt from the learner's OWN intent (§5/14). */
  @Post('placement/start')
  @HttpCode(200)
  start(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: StartPlacementDto) {
    return this.assessment.start(principal.userId, dto.learningIntentId);
  }

  /** Resume/read an own attempt — pure read, no progression on reload (§22/37). */
  @Get('attempts/:attemptId')
  getAttempt(@CurrentPrincipal() principal: AuthPrincipal, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.assessment.getAttempt(principal.userId, attemptId);
  }

  /** Submit an answer; server scores + advances, and on completion derives the Skill Profile (§23/25/28). */
  @Post('attempts/:attemptId/responses')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: SubmitResponseDto,
  ) {
    return this.flow.submitResponse(principal.userId, attemptId, dto.itemId, dto.answer);
  }
}
