import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ConcurrentEditDto, NO_CONTROL, Trim } from './common.dto';

/** POST /staff/content/levels/:levelId/modules — DRAFT Module. */
export class CreateModuleDto {
  @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title!: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsInt() @Min(0)
  sortOrder!: number;
}

export class UpdateModuleDto extends ConcurrentEditDto {
  @IsOptional() @IsString() @Trim() @MinLength(1) @MaxLength(300) @Matches(NO_CONTROL, { message: 'title contains control characters' })
  title?: string;

  @IsOptional() @IsString() @Trim() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
