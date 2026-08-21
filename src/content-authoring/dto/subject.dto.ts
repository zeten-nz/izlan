import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, OptionalPresent, SLUG_RE, Trim } from './common.dto';

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

/**
 * PATCH /staff/content/subjects/:id — mutable metadata only; no status/createdBy (§12). Non-null fields use
 * `@OptionalPresent()` so an explicit `null` is rejected 400; `description` is intentionally nullable (clearable).
 */
export class UpdateSubjectDto extends ConcurrentEditDto {
  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @OptionalPresent() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string | null;

  @OptionalPresent() @IsInt() @Min(0)
  sortOrder?: number;
}
