import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { ReviewSessionService } from './review-session.service';
import { SubmitActivityAttemptDto } from '../lesson-execution/dto/submit-activity-attempt.dto';

/**
 * Review Session API (Phase 1.9B-2). Own-user (global AuthGuard). Explicit learner-triggered review execution;
 * candidate authority is server-side (§4/15). No normal-Lesson-start bypass, no DailyPlan/Roadmap mutation.
 */
@Controller('review-sessions')
export class ReviewSessionController {
  constructor(private readonly service: ReviewSessionService) {}

  /** Start (or resume) a review session for a currently-valid ReviewCandidate. No body. */
  @Post('me/subjects/:subjectId/skills/:skillId/lessons/:lessonId/start')
  @HttpCode(200)
  start(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
  ) {
    return this.service.start(principal.userId, subjectId, skillId, lessonId);
  }

  /** Resume/read an own review session (selected activities in snapshot order + attempt summary). */
  @Get(':sessionId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.service.getSession(principal.userId, sessionId);
  }

  /** Submit an objective review attempt (server scores; review provenance). */
  @Post(':sessionId/activities/:activityId/attempts')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: SubmitActivityAttemptDto,
  ) {
    return this.service.submitAttempt(principal.userId, sessionId, activityId, dto.clientRequestId, dto.answer);
  }

  /** Complete the review session once every selected activity has a review-linked attempt. No body. */
  @Post(':sessionId/complete')
  @HttpCode(200)
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.service.complete(principal.userId, sessionId);
  }
}
