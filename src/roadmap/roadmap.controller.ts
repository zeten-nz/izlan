import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { RoadmapService } from './roadmap.service';
import { RoadmapReadService } from './read/roadmap-read.service';

/**
 * Roadmap API (Phase 1.6A generation + 1.6B read model / reconciliation). Global AuthGuard →
 * authenticated; every operation scoped to principal.userId (own roadmaps only, §47). GET endpoints are
 * strictly read-only (no reconciliation side-effect, §16); the read model is one shared projector (§22/23).
 */
@Controller('roadmaps')
export class RoadmapController {
  constructor(
    private readonly roadmap: RoadmapService,
    private readonly read: RoadmapReadService,
  ) {}

  /** Generate (or idempotently return) the initial roadmap for an owned completed diagnostic (1.6A). */
  @Post('diagnostics/:attemptId/initial')
  @HttpCode(200)
  generateInitial(@CurrentPrincipal() principal: AuthPrincipal, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.roadmap.generateInitial(principal.userId, attemptId);
  }

  /** Current ACTIVE roadmap for a subject, as the progress read model (excludes COMPLETED/ARCHIVED). */
  @Get('me/subjects/:subjectId/active')
  active(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.read.getActive(principal.userId, subjectId);
  }

  /** An own roadmap by id as the progress read model (any status; 404 for other users). */
  @Get(':roadmapId')
  byId(@CurrentPrincipal() principal: AuthPrincipal, @Param('roadmapId', ParseUUIDPipe) roadmapId: string) {
    return this.read.getById(principal.userId, roadmapId);
  }

  /** Command: reconcile ACTIVE → COMPLETED when every item is completed (idempotent; §18). */
  @Post(':roadmapId/reconcile')
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal, @Param('roadmapId', ParseUUIDPipe) roadmapId: string) {
    return this.roadmap.reconcileCompletion(principal.userId, roadmapId);
  }
}
