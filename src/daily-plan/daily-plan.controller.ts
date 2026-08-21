import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { DailyPlanService } from './daily-plan.service';

/**
 * Daily Plan API (Phase 1.7A §50/51). Global AuthGuard → authenticated; own-user only (§68).
 * Everything (date, timezone, roadmap, topic, items) is server-derived — no request body/params.
 */
@Controller('daily-plans')
export class DailyPlanController {
  constructor(private readonly dailyPlan: DailyPlanService) {}

  /** Read today's CURRENT plan (profile-local date). Never generates/mutates; 404 if none. */
  @Get('today')
  today(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.dailyPlan.getToday(principal.userId);
  }

  /** Generate-or-return today's CURRENT plan. Idempotent per local day (one Topic per day). */
  @Post('today')
  @HttpCode(200)
  generateToday(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.dailyPlan.generateOrGetToday(principal.userId);
  }
}
