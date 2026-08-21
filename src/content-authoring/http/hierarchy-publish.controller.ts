import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { HierarchyPublishService } from '../publish/hierarchy-publish.service';
import { CONTENT_PUBLISH } from '../content-authoring.constants';
import { ConcurrentEditDto } from '../dto/common.dto';

/**
 * Explicit hierarchy publication (Phase 2.2B, §8-10). content.publish + SubjectAssignment; top-down (a container can
 * publish only when its ancestors are already PUBLISHED). Never uses content.subject.manage as the publish authority.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_PUBLISH)
export class HierarchyPublishController {
  constructor(private readonly publish: HierarchyPublishService) {}

  @Post('subjects/:id/publish')
  subject(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: ConcurrentEditDto) {
    return this.publish.publishSubject(p.userId, id, dto);
  }
  @Post('tracks/:id/publish')
  track(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: ConcurrentEditDto) {
    return this.publish.publishTrack(p.userId, id, dto);
  }
  @Post('levels/:id/publish')
  level(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: ConcurrentEditDto) {
    return this.publish.publishLevel(p.userId, id, dto);
  }
  @Post('modules/:id/publish')
  module(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: ConcurrentEditDto) {
    return this.publish.publishModule(p.userId, id, dto);
  }
  @Post('topics/:id/publish')
  topic(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: ConcurrentEditDto) {
    return this.publish.publishTopic(p.userId, id, dto);
  }
}
