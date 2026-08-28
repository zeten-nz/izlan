import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { TeachingSessionService } from './teaching-session.service';
import { SubmitTeachingActivityDto } from './dto/submit-teaching-activity.dto';

/**
 * V2 Teaching Session API. Global AuthGuard → authenticated; own-user only (404-safe on another user's
 * session). A session pins immutable revisions on first start and resumes them without repinning; objective
 * submissions are server-scored + idempotent; mastery-check derives evidence, evaluates it, and — only when
 * satisfied — records a LEARNED acquisition.
 */
@Controller('v2')
export class TeachingSessionController {
  constructor(private readonly sessions: TeachingSessionService) {}

  /** Start or resume the learner's teaching session for a roadmap point. */
  @Post('roadmap-points/:pointId/teaching-session/start')
  @HttpCode(200)
  start(@CurrentPrincipal() principal: AuthPrincipal, @Param('pointId', ParseUUIDPipe) pointId: string) {
    return this.sessions.startOrResume(principal.userId, pointId);
  }

  /** Resume/read an own teaching session by id — returns the pinned stages + progress. */
  @Get('teaching-sessions/:sessionId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessions.getSession(principal.userId, sessionId);
  }

  /** Submit an objective activity answer under the pinned session; server scores + records evidence. */
  @Post('teaching-sessions/:sessionId/activities/:activityId/attempts')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: SubmitTeachingActivityDto,
  ) {
    return this.sessions.submitActivity(principal.userId, sessionId, activityId, dto.clientRequestId, dto.answer);
  }

  /** Run mastery evaluation over the session's exact evidence; on SATISFIED records LEARNED acquisition. */
  @Post('teaching-sessions/:sessionId/mastery-check')
  @HttpCode(200)
  masteryCheck(@CurrentPrincipal() principal: AuthPrincipal, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessions.runMasteryCheck(principal.userId, sessionId);
  }
}
