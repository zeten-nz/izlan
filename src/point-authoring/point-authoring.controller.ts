import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import { RequirePermissions } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { CONTENT_AUTHOR, CONTENT_PUBLISH } from '../content-authoring/content-authoring.constants';
import { PointAuthoringService } from './point-authoring.service';
import {
  AttachSourceDto, CreatePointDto, CreateSourceDto, PublishPointDto, RaiseIssueDto, ResolveIssueDto, ReturnPointToDraftDto,
  ReviewPointDto, SetBlueprintStagesDto, SetMasteryDto, SetPointPrerequisitesDto, SetPointSkillsDto, SubmitPointReviewDto, UpdatePointRevisionDto,
} from './dto/point-authoring.dto';

/**
 * V2 Roadmap Point authoring API. Base `/api/staff/content/v2`. Authoring routes require content.author; review /
 * return-to-draft / publish require content.publish — plus, in the service, the actor's SubjectAssignment for the
 * point's Subject (no ADMIN role-name bypass, IDOR-safe 404).
 */
@Controller('staff/content/v2')
export class PointAuthoringController {
  constructor(private readonly svc: PointAuthoringService) {}

  @Get('subjects/:subjectId/levels')
  @RequirePermissions(CONTENT_AUTHOR)
  levels(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.listLevels(p.userId, subjectId);
  }

  @Get('subjects/:subjectId/skills')
  @RequirePermissions(CONTENT_AUTHOR)
  subjectSkills(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.listSubjectSkills(p.userId, subjectId);
  }

  @Get('subjects/:subjectId/bindable-activities')
  @RequirePermissions(CONTENT_AUTHOR)
  bindable(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.svc.listBindableActivities(p.userId, subjectId);
  }

  @Get('levels/:levelId/points')
  @RequirePermissions(CONTENT_AUTHOR)
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('levelId', ParseUUIDPipe) levelId: string) {
    return this.svc.listPoints(p.userId, levelId);
  }

  @Post('levels/:levelId/points')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  create(@CurrentPrincipal() p: AuthPrincipal, @Param('levelId', ParseUUIDPipe) levelId: string, @Body() dto: CreatePointDto) {
    return this.svc.createPoint(p.userId, levelId, dto);
  }

  @Get('points/:pointId')
  @RequirePermissions(CONTENT_AUTHOR)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('pointId', ParseUUIDPipe) pointId: string) {
    return this.svc.getPoint(p.userId, pointId);
  }

  @Get('points/:pointId/readiness')
  @RequirePermissions(CONTENT_AUTHOR)
  readiness(@CurrentPrincipal() p: AuthPrincipal, @Param('pointId', ParseUUIDPipe) pointId: string) {
    return this.svc.getReadiness(p.userId, pointId);
  }

  @Post('points/:pointId/revise')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  revise(@CurrentPrincipal() p: AuthPrincipal, @Param('pointId', ParseUUIDPipe) pointId: string) {
    return this.svc.createDraftFromPublished(p.userId, pointId);
  }

  @Patch('point-revisions/:revisionId')
  @RequirePermissions(CONTENT_AUTHOR)
  update(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: UpdatePointRevisionDto) {
    return this.svc.updatePointRevision(p.userId, revisionId, dto);
  }

  @Put('point-revisions/:revisionId/skills')
  @RequirePermissions(CONTENT_AUTHOR)
  setSkills(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: SetPointSkillsDto) {
    return this.svc.setPointSkills(p.userId, revisionId, dto);
  }

  @Put('point-revisions/:revisionId/prerequisites')
  @RequirePermissions(CONTENT_AUTHOR)
  setPrereqs(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: SetPointPrerequisitesDto) {
    return this.svc.setPointPrerequisites(p.userId, revisionId, dto);
  }

  @Put('blueprint-revisions/:revisionId/stages')
  @RequirePermissions(CONTENT_AUTHOR)
  setStages(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: SetBlueprintStagesDto) {
    return this.svc.setBlueprintStages(p.userId, revisionId, dto);
  }

  @Put('mastery-revisions/:revisionId')
  @RequirePermissions(CONTENT_AUTHOR)
  setMastery(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: SetMasteryDto) {
    return this.svc.setMastery(p.userId, revisionId, dto);
  }

  @Get('sources')
  @RequirePermissions(CONTENT_AUTHOR)
  listSources(@CurrentPrincipal() p: AuthPrincipal) {
    return this.svc.listSources(p.userId);
  }

  @Post('sources')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  createSource(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: CreateSourceDto) {
    return this.svc.createSource(p.userId, dto);
  }

  @Post('point-revisions/:revisionId/sources')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  attachSource(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: AttachSourceDto) {
    return this.svc.attachSource(p.userId, revisionId, dto);
  }

  @Post('issues')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  raiseIssue(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: RaiseIssueDto) {
    return this.svc.raiseIssue(p.userId, dto);
  }

  @Post('issues/:issueId/resolve')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  resolveIssue(@CurrentPrincipal() p: AuthPrincipal, @Param('issueId', ParseUUIDPipe) issueId: string, @Body() dto: ResolveIssueDto) {
    return this.svc.resolveIssue(p.userId, issueId, dto);
  }

  @Post('point-revisions/:revisionId/submit-review')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(200)
  submitReview(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: SubmitPointReviewDto) {
    return this.svc.submitReview(p.userId, revisionId, dto);
  }

  @Post('point-revisions/:revisionId/return-draft')
  @RequirePermissions(CONTENT_PUBLISH)
  @HttpCode(200)
  returnDraft(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: ReturnPointToDraftDto) {
    return this.svc.returnToDraft(p.userId, revisionId, dto);
  }

  @Post('point-revisions/:revisionId/review')
  @RequirePermissions(CONTENT_PUBLISH)
  @HttpCode(200)
  review(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: ReviewPointDto) {
    return this.svc.reviewPoint(p.userId, revisionId, dto);
  }

  @Post('point-revisions/:revisionId/publish')
  @RequirePermissions(CONTENT_PUBLISH)
  @HttpCode(200)
  publish(@CurrentPrincipal() p: AuthPrincipal, @Param('revisionId', ParseUUIDPipe) revisionId: string, @Body() dto: PublishPointDto) {
    return this.svc.publishPoint(p.userId, revisionId, dto);
  }
}
