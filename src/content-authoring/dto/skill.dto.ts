import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, OptionalPresent, Trim } from './common.dto';

/**
 * POST /staff/content/subjects/:subjectId/skills — creates an ACTIVE Skill. `subjectId` (route), `status`, timestamps
 * are server-owned (rejected 400 if sent). `code`/`description` are optional/nullable; no CEFR/skill enum hard-coded.
 */
export class CreateSkillDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(NO_CONTROL, { message: 'name contains control characters' })
  name!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(80) @Matches(NO_CONTROL, { message: 'code contains control characters' })
  code?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

/** PATCH /staff/content/skills/:skillId — metadata only (ACTIVE skills); no subjectId/status. */
export class UpdateSkillDto extends ConcurrentEditDto {
  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(NO_CONTROL, { message: 'name contains control characters' })
  name?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(80) @Matches(NO_CONTROL, { message: 'code contains control characters' })
  code?: string | null;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string | null;

  @OptionalPresent() @IsInt() @Min(0)
  sortOrder?: number;
}
