import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { AdaptationService } from './adaptation.service';

/**
 * V2 Adaptation API — the next-useful-action surface and the point-scoped review entry. Global AuthGuard;
 * every operation is own-user (404-safe). No scoring/mastery here — it reads the derived roadmap and delegates
 * review to the reused Review Session aggregate.
 */
@Controller('v2')
export class AdaptationController {
  constructor(private readonly adaptation: AdaptationService) {}

  /** The single most useful next action from current evidence (repair > review > continue > done). */
  @Get('roadmap/subjects/:subjectId/focus')
  focus(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.adaptation.getFocus(principal.userId, subjectId);
  }

  /** Start (or resume) a review session for one skill of an acquired point; returns the reused review session. */
  @Post('roadmap-points/:pointId/review/skills/:skillId/start')
  @HttpCode(200)
  startReview(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('pointId', ParseUUIDPipe) pointId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ) {
    return this.adaptation.startPointReview(principal.userId, pointId, skillId);
  }
}
