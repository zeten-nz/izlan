import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { LearnerSignalsService } from './learner-signals.service';

/**
 * Learner Signals API (Phase 1.8B). Own-user only (global AuthGuard). Read current ACTIVE advisory signals;
 * reconcile/repair signal state from existing evidence. No manual dismiss/resolve/snooze in v1 (§34).
 */
@Controller('learner-signals')
export class LearnerSignalsController {
  constructor(private readonly service: LearnerSignalsService) {}

  /** Current ACTIVE learner signals for principal + Subject. */
  @Get('me/subjects/:subjectId')
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.service.getActiveSignals(principal.userId, subjectId);
  }

  /** Repair/reconcile signal state for every relevant skill in the Subject (idempotent; creates no evidence). */
  @Post('me/subjects/:subjectId/reconcile')
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.service.reconcileSubject(principal.userId, subjectId);
  }
}
