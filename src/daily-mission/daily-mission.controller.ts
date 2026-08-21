import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { DailyMissionService } from './daily-mission.service';

/**
 * Daily Missions API (Phase 2.0B). Own-user only (global AuthGuard). GET is read-only (no materialization);
 * reconcile repairs missing current-day completions from existing evidence. No reward/XP/IZL fields.
 */
@Controller('daily-missions')
export class DailyMissionController {
  constructor(private readonly service: DailyMissionService) {}

  /** Today's mission catalog + persisted completion state. */
  @Get('me/today')
  today(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.getToday(principal.userId);
  }

  /** Repair missing current-day mission completions from existing evidence (idempotent; no body). */
  @Post('me/today/reconcile')
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.reconcileToday(principal.userId);
  }
}
