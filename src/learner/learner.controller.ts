import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { LearnerHomeService } from './learner.service';

/**
 * V2 Learner first-run API. One authenticated, own-user read that tells the app where the learner should land
 * (onboarding / placement / today) plus any resume action — so the client never has to sequence onboarding +
 * placement + roadmap reads itself. Read-only; owns no state.
 */
@Controller('v2/learner')
export class LearnerController {
  constructor(private readonly home: LearnerHomeService) {}

  /** The server-authoritative landing decision for the current learner. */
  @Get('home')
  getHome(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.home.getHome(principal.userId);
  }
}
