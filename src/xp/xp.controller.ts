import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { XpService } from './xp.service';

/**
 * XP API (Phase 2.0C-2 + 2.0D). Own-user only (global AuthGuard). GET returns canonical progression derived from
 * SUM(XpGrant.amount) — read-only, never writes/repairs XpBalance (§27), correct even if the cache is stale.
 * Reconcile repairs missing mission XP + rebuilds the projection. No manual claim / grant-creation endpoint / no
 * client-supplied amount/completion/policy (§41/§42/§62). Minimal projection — never leaks raw evidence.
 */
@Controller('xp')
export class XpController {
  constructor(private readonly service: XpService) {}

  /** Canonical XP progression (totalXp, currentLevel, next-level progress). Zero grants → Level 1 / 0 XP (200). */
  @Get('me')
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.getProgression(principal.userId);
  }

  /** Materialize any missing mission XP + rebuild the projection for this learner across all history (idempotent; no body). */
  @Post('me/reconcile')
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.reconcile(principal.userId);
  }
}
