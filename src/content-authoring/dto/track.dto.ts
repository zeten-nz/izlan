import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, SLUG_RE, Trim } from './common.dto';

/** POST /staff/content/subjects/:subjectId/tracks — DRAFT Track under an assigned Subject. */
export class CreateTrackDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug!: string;

  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class UpdateTrackDto extends ConcurrentEditDto {
  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(200) @Matches(SLUG_RE, { message: 'slug must be lowercase kebab-case' })
  slug?: string;

  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
