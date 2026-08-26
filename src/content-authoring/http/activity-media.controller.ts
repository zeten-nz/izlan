import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequirePermissions, CurrentPrincipal } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { ActivityMediaService } from '../activity-media.service';
import { AttachActivityMediaDto, DetachActivityMediaDto } from '../dto/activity-media.dto';

/** Activity media attach/detach (media foundation). content.author + SubjectAssignment; DRAFT revision only. */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class ActivityMediaController {
  constructor(private readonly service: ActivityMediaService) {}

  @Get('activities/:activityId/media')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId', ParseUUIDPipe) activityId: string) {
    return this.service.listActivityMedia(p.userId, activityId);
  }

  @Post('activities/:activityId/media')
  @HttpCode(201)
  attach(@CurrentPrincipal() p: AuthPrincipal, @Param('activityId', ParseUUIDPipe) activityId: string, @Body() dto: AttachActivityMediaDto) {
    return this.service.attach(p.userId, activityId, dto);
  }

  @Delete('activities/:activityId/media/:mediaAssetId')
  detach(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Param('mediaAssetId', ParseUUIDPipe) mediaAssetId: string,
    @Body() dto: DetachActivityMediaDto,
  ) {
    return this.service.detach(p.userId, activityId, mediaAssetId, dto);
  }
}
