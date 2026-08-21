import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { ReviewService } from './review.service';

/**
 * Review Candidates API (Phase 1.9A §76). Own-user only (global AuthGuard). READ-ONLY — no POST, no mutation,
 * no ReviewSession, no execution/start endpoint (§34/67/78). Reading never resolves a signal (§36/68).
 */
@Controller('review-candidates')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  /** Deterministic review candidates for principal + Subject, grouped by Skill. */
  @Get('me/subjects/:subjectId')
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.service.getCandidates(principal.userId, subjectId);
  }
}
