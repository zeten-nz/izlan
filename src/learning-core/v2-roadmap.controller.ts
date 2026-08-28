import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { V2RoadmapService } from './v2-roadmap.service';

/**
 * V2 Roadmap API. Global AuthGuard → authenticated; own-user only (the generation is scoped by userId).
 * Read-through: opens (creating once) the learner's CURRENT roadmap generation and projects each point with
 * a live LEARNED overlay from the authoritative acquisition log.
 */
@Controller('v2/roadmap')
export class V2RoadmapController {
  constructor(private readonly roadmap: V2RoadmapService) {}

  @Get('subjects/:subjectId')
  getRoadmap(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.roadmap.getRoadmap(principal.userId, subjectId);
  }
}
