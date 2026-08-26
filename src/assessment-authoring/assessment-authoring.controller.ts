import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH } from './assessment-authoring.constants';
import { AssessmentAuthoringService } from './assessment-authoring.service';
import {
  CreateItemDto,
  CreateVersionDto,
  DeleteItemDto,
  EnsureDefinitionDto,
  PublishVersionDto,
  ReorderItemsDto,
  ReturnDraftDto,
  SubmitReviewDto,
  UpdateDefinitionDto,
  UpdateItemDto,
  UpdateVersionConfigDto,
} from './dto/assessment-authoring.dto';

/**
 * Assessment authoring (V1 — diagnostic/placement). Reads + drafting are assessment.author; return-to-draft and publish
 * are assessment.publish. Every operation is SubjectAssignment-scoped in the service (no role-name bypass). Learner
 * runtime routes (@Controller('assessments')) are untouched.
 */
@Controller('staff/content/assessments')
export class AssessmentAuthoringController {
  constructor(private readonly service: AssessmentAuthoringService) {}

  // ── Reads ──
  @Get('subjects/:subjectId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  getSubject(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.service.getSubjectAssessments(p.userId, subjectId);
  }

  @Get('versions/:versionId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  getVersion(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.service.getVersion(p.userId, versionId);
  }

  @Get('versions/:versionId/readiness')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  readiness(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.service.getReadiness(p.userId, versionId);
  }

  @Get('versions/:versionId/preview')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  preview(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.service.preview(p.userId, versionId);
  }

  @Get(':definitionId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  getDefinition(@CurrentPrincipal() p: AuthPrincipal, @Param('definitionId', ParseUUIDPipe) definitionId: string) {
    return this.service.getDefinition(p.userId, definitionId);
  }

  // ── Definition ──
  @Post('subjects/:subjectId')
  @HttpCode(200) // idempotent ensure — may return the existing DIAGNOSTIC
  @RequirePermissions(ASSESSMENT_AUTHOR)
  ensureDefinition(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId', ParseUUIDPipe) subjectId: string, @Body() dto: EnsureDefinitionDto) {
    return this.service.ensureDefinition(p.userId, subjectId, dto);
  }

  @Patch(':definitionId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  updateDefinition(@CurrentPrincipal() p: AuthPrincipal, @Param('definitionId', ParseUUIDPipe) definitionId: string, @Body() dto: UpdateDefinitionDto) {
    return this.service.updateDefinition(p.userId, definitionId, dto);
  }

  // ── Versions ──
  @Post(':definitionId/versions')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  createVersion(@CurrentPrincipal() p: AuthPrincipal, @Param('definitionId', ParseUUIDPipe) definitionId: string, @Body() dto: CreateVersionDto) {
    return this.service.createVersion(p.userId, definitionId, dto);
  }

  @Patch('versions/:versionId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  updateConfig(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: UpdateVersionConfigDto) {
    return this.service.updateConfig(p.userId, versionId, dto);
  }

  // ── Items ──
  @Post('versions/:versionId/items')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  createItem(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: CreateItemDto) {
    return this.service.createItem(p.userId, versionId, dto);
  }

  @Post('versions/:versionId/items/reorder')
  @HttpCode(200)
  @RequirePermissions(ASSESSMENT_AUTHOR)
  reorder(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: ReorderItemsDto) {
    return this.service.reorder(p.userId, versionId, dto);
  }

  @Patch('items/:itemId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  updateItem(@CurrentPrincipal() p: AuthPrincipal, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateItemDto) {
    return this.service.updateItem(p.userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @RequirePermissions(ASSESSMENT_AUTHOR)
  deleteItem(@CurrentPrincipal() p: AuthPrincipal, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: DeleteItemDto) {
    return this.service.deleteItem(p.userId, itemId, dto);
  }

  // ── Workflow ──
  @Post('versions/:versionId/submit-review')
  @HttpCode(200)
  @RequirePermissions(ASSESSMENT_AUTHOR)
  submitReview(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: SubmitReviewDto) {
    return this.service.submitReview(p.userId, versionId, dto);
  }

  @Post('versions/:versionId/return-draft')
  @HttpCode(200)
  @RequirePermissions(ASSESSMENT_PUBLISH)
  returnDraft(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: ReturnDraftDto) {
    return this.service.returnDraft(p.userId, versionId, dto);
  }

  @Post('versions/:versionId/publish')
  @HttpCode(200)
  @RequirePermissions(ASSESSMENT_PUBLISH)
  publish(@CurrentPrincipal() p: AuthPrincipal, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: PublishVersionDto) {
    return this.service.publish(p.userId, versionId, dto);
  }
}
