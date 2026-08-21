import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { SkillService } from '../skill.service';
import { CONTENT_AUTHOR } from '../content-authoring.constants';
import { CreateSkillDto, UpdateSkillDto } from '../dto/skill.dto';

/**
 * Staff Subject-scoped Skill authoring (Phase 2.2A-3). content.author + SubjectAssignment (from Skill.subjectId).
 * No DELETE / archive / merge in this phase.
 */
@Controller('staff/content')
@RequirePermissions(CONTENT_AUTHOR)
export class SkillsController {
  constructor(private readonly skills: SkillService) {}

  @Get('subjects/:subjectId/skills')
  list(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId') subjectId: string) {
    return this.skills.listSkills(p.userId, subjectId);
  }

  @Post('subjects/:subjectId/skills')
  create(@CurrentPrincipal() p: AuthPrincipal, @Param('subjectId') subjectId: string, @Body() dto: CreateSkillDto) {
    return this.skills.createSkill(p.userId, subjectId, dto);
  }

  @Get('skills/:skillId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('skillId') skillId: string) {
    return this.skills.getSkill(p.userId, skillId);
  }

  @Patch('skills/:skillId')
  update(@CurrentPrincipal() p: AuthPrincipal, @Param('skillId') skillId: string, @Body() dto: UpdateSkillDto) {
    return this.skills.updateSkill(p.userId, skillId, dto);
  }
}
