import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { DailyLearningService } from './daily-learning.service';

/**
 * V2 Daily Learning API. Global AuthGuard; every operation is own-user (derived from principal.userId; no target
 * id in the URL beyond the subject the learner is assigned to). The `me` routes resolve the learner's primary
 * subject from their learning intent; the subject-scoped routes take an explicit subjectId.
 */
@Controller('v2/daily')
export class DailyLearningController {
  constructor(private readonly svc: DailyLearningService) {}

  /** Read today's CURRENT plan for the learner's primary subject; never generates. 404 if none. */
  @Get('me/today')
  myToday(@CurrentPrincipal() p: AuthPrincipal) {
    return this.svc.getMyToday(p.userId);
  }

  /** Generate-or-return today's CURRENT plan for the primary subject (idempotent per local day). */
  @Post('me/today')
  @HttpCode(200)
  generateMyToday(@CurrentPrincipal() p: AuthPrincipal) {
    return this.svc.generateMyToday(p.userId);
  }

  @Get('subjects/:subjectId/today')
  today(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.getToday(p.userId, subjectId);
  }

  @Post('subjects/:subjectId/today')
  @HttpCode(200)
  generateToday(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.generateOrGetToday(p.userId, subjectId);
  }
}
