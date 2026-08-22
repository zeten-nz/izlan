import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequirePermissions, CurrentPrincipal } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { CONTENT_AUTHOR } from '../../content-authoring/content-authoring.constants';
import { ImportService } from '../import.service';

/**
 * Topic-scoped bulk content import (Phase 2.2D, TD-253). `content.author` + SubjectAssignment (resolved from the Topic
 * server-side) required for BOTH routes. The body is the versioned import document, typed `unknown` so the global
 * ValidationPipe does not pre-reject unknown fields — the strict import parser owns all document validation and
 * returns a dry-run report (validate) or applies atomically (apply). content.publish is NOT required (DRAFT only).
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Post('topics/:topicId/import/validate')
  @HttpCode(200)
  validate(@CurrentPrincipal() principal: AuthPrincipal, @Param('topicId', ParseUUIDPipe) topicId: string, @Body() body: unknown) {
    return this.service.validate(principal.userId, topicId, body);
  }

  @Post('topics/:topicId/import/apply')
  @HttpCode(201)
  apply(@CurrentPrincipal() principal: AuthPrincipal, @Param('topicId', ParseUUIDPipe) topicId: string, @Body() body: unknown) {
    return this.service.apply(principal.userId, topicId, body);
  }
}
