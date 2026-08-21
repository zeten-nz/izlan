import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { HierarchyService } from '../hierarchy.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { CreateTrackDto, UpdateTrackDto } from '../dto/track.dto';
import { CreateLevelDto, UpdateLevelDto } from '../dto/level.dto';
import { CreateModuleDto, UpdateModuleDto } from '../dto/module.dto';
import { CreateTopicDto, UpdateTopicDto } from '../dto/topic.dto';

/**
 * Staff hierarchy authoring — Track → Level → Module → Topic (Phase 2.2A-1). All require content.author; the
 * service resolves the Subject from DB relationships and enforces the actor's SubjectAssignment (§6). Creates are
 * DRAFT; updates are DRAFT-only with optimistic concurrency; every mutation is audited in-transaction.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  // ── Track (under Subject) ──
  @Post('subjects/:subjectId/tracks')
  createTrack(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId') subjectId: string, @Body() dto: CreateTrackDto) {
    return this.hierarchy.createTrack(p.userId, subjectId, dto);
  }
  @Get('subjects/:subjectId/tracks')
  listTracks(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId') subjectId: string) {
    return this.hierarchy.listTracks(p.userId, subjectId);
  }
  @Get('tracks/:id')
  getTrack(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string) {
    return this.hierarchy.getTrack(p.userId, id);
  }
  @Patch('tracks/:id')
  updateTrack(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateTrackDto) {
    return this.hierarchy.updateTrack(p.userId, id, dto);
  }

  // ── Level (under Track) ──
  @Post('tracks/:trackId/levels')
  createLevel(@CurrentPrincipal() p: AuthPrincipal, @Param('trackId') trackId: string, @Body() dto: CreateLevelDto) {
    return this.hierarchy.createLevel(p.userId, trackId, dto);
  }
  @Get('tracks/:trackId/levels')
  listLevels(@CurrentPrincipal() p: AuthPrincipal, @Param('trackId') trackId: string) {
    return this.hierarchy.listLevels(p.userId, trackId);
  }
  @Get('levels/:id')
  getLevel(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string) {
    return this.hierarchy.getLevel(p.userId, id);
  }
  @Patch('levels/:id')
  updateLevel(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.hierarchy.updateLevel(p.userId, id, dto);
  }

  // ── Module (under Level) ──
  @Post('levels/:levelId/modules')
  createModule(@CurrentPrincipal() p: AuthPrincipal, @Param('levelId') levelId: string, @Body() dto: CreateModuleDto) {
    return this.hierarchy.createModule(p.userId, levelId, dto);
  }
  @Get('levels/:levelId/modules')
  listModules(@CurrentPrincipal() p: AuthPrincipal, @Param('levelId') levelId: string) {
    return this.hierarchy.listModules(p.userId, levelId);
  }
  @Get('modules/:id')
  getModule(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string) {
    return this.hierarchy.getModule(p.userId, id);
  }
  @Patch('modules/:id')
  updateModule(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateModuleDto) {
    return this.hierarchy.updateModule(p.userId, id, dto);
  }

  // ── Topic (under Module) ──
  @Post('modules/:moduleId/topics')
  createTopic(@CurrentPrincipal() p: AuthPrincipal, @Param('moduleId') moduleId: string, @Body() dto: CreateTopicDto) {
    return this.hierarchy.createTopic(p.userId, moduleId, dto);
  }
  @Get('modules/:moduleId/topics')
  listTopics(@CurrentPrincipal() p: AuthPrincipal, @Param('moduleId') moduleId: string) {
    return this.hierarchy.listTopics(p.userId, moduleId);
  }
  @Get('topics/:id')
  getTopic(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string) {
    return this.hierarchy.getTopic(p.userId, id);
  }
  @Patch('topics/:id')
  updateTopic(@CurrentPrincipal() p: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateTopicDto) {
    return this.hierarchy.updateTopic(p.userId, id, dto);
  }
}
