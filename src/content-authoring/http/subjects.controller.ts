import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { SubjectService } from '../subject.service';
import { CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE } from '../content-authoring.constants';
import { CreateSubjectDto, UpdateSubjectDto } from '../dto/subject.dto';
import { AssignUserDto } from '../dto/assignment.dto';

/**
 * Staff Subject + assignment API (Phase 2.2A-1). Global AuthGuard → authenticated; PermissionsGuard enforces the
 * permission code. Subject reads/metadata = content.author (+ DB-resolved assignment scope in the service);
 * Subject create + assignment management = content.subject.manage. No role-name bypass.
 */
@Controller('staff/content')
export class SubjectsController {
  constructor(private readonly subjects: SubjectService) {}

  @Get('subjects')
  @RequirePermissions(CONTENT_AUTHOR)
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.subjects.listAssignedSubjects(principal.userId);
  }

  @Post('subjects')
  @RequirePermissions(CONTENT_SUBJECT_MANAGE)
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: CreateSubjectDto) {
    return this.subjects.createSubject(principal.userId, dto);
  }

  @Get('subjects/:id')
  @RequirePermissions(CONTENT_AUTHOR)
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.subjects.getSubject(principal.userId, id);
  }

  @Patch('subjects/:id')
  @RequirePermissions(CONTENT_AUTHOR)
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.subjects.updateSubject(principal.userId, id, dto);
  }

  @Get('subjects/:subjectId/assignments')
  @RequirePermissions(CONTENT_SUBJECT_MANAGE)
  listAssignments(@Param('subjectId') subjectId: string) {
    return this.subjects.listAssignments(subjectId);
  }

  @Post('subjects/:subjectId/assignments')
  @RequirePermissions(CONTENT_SUBJECT_MANAGE)
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId') subjectId: string, @Body() dto: AssignUserDto) {
    return this.subjects.assignUser(principal.userId, subjectId, dto.userId);
  }

  @Delete('subjects/:subjectId/assignments/:userId')
  @RequirePermissions(CONTENT_SUBJECT_MANAGE)
  remove(@CurrentPrincipal() principal: AuthPrincipal, @Param('subjectId') subjectId: string, @Param('userId') userId: string) {
    return this.subjects.removeAssignment(principal.userId, subjectId, userId);
  }
}
