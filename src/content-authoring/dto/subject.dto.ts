import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, SLUG_RE, Trim } from './common.dto';

/** POST /staff/content/subjects — creates a DRAFT Subject (status/createdBy never from the client, §10). */
export class CreateSubjectDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug!: string;

  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

/** PATCH /staff/content/subjects/:id — mutable metadata only; no status/createdBy (§12). */
export class UpdateSubjectDto extends ConcurrentEditDto {
  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
