import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsISO8601, IsInt, IsNotEmpty, IsString, IsUUID, Min, MaxLength, ValidateNested } from 'class-validator';
import { OptionalPresent, Trim } from '../../content-authoring/dto/common.dto';

const AUTHORABLE_FORMATS = ['single_choice', 'multiple_choice', 'true_false'] as const;
export type AuthorableItemFormat = (typeof AUTHORABLE_FORMATS)[number];

/** POST /subjects/:subjectId — ensure/create the Subject's DIAGNOSTIC definition (idempotent). Title/description optional. */
export class EnsureDefinitionDto {
  @OptionalPresent()
  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(200)
  title?: string;

  @OptionalPresent()
  @IsString()
  @Trim()
  @MaxLength(2000)
  description?: string;
}

/** PATCH /:definitionId — edit title/description (subjectId + purposeScope are immutable through the API). OCC on Definition.updatedAt. */
export class UpdateDefinitionDto {
  @IsISO8601({ strict: true }, { message: 'expectedUpdatedAt must be an ISO-8601 timestamp' })
  expectedUpdatedAt!: string;

  @OptionalPresent()
  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(200)
  title?: string;

  @OptionalPresent()
  @IsString()
  @Trim()
  @MaxLength(2000)
  description?: string;
}

/** POST /:definitionId/versions — create a new DRAFT version, either blank or cloned from the current published version. */
export class CreateVersionDto {
  @IsIn(['blank', 'clone_current'], { message: 'mode must be blank or clone_current' })
  mode!: 'blank' | 'clone_current';
}

/** PATCH /versions/:versionId — structured config edit (Methodist-editable fields only). OCC on Version.updatedAt. */
export class UpdateVersionConfigDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;

  @OptionalPresent()
  @IsInt()
  @Min(1)
  itemsPerSkill?: number;

  @OptionalPresent()
  @IsInt()
  @Min(1)
  maxItems?: number;

  @OptionalPresent()
  @IsInt()
  @Min(1)
  startDifficulty?: number;
}

export class ItemOptionDto {
  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'option id must not be empty' })
  @MaxLength(120)
  id!: string;

  @IsString()
  @MaxLength(2000)
  text!: string;
}

/** POST /versions/:versionId/items — create an item in the version's DRAFT pool. OCC on the Version token. */
export class CreateItemDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;

  @IsIn(AUTHORABLE_FORMATS, { message: 'unsupported format' })
  format!: AuthorableItemFormat;

  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'prompt must not be empty' })
  @MaxLength(4000)
  prompt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemOptionDto)
  options!: ItemOptionDto[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  correctOptionIds!: string[];

  @IsUUID(undefined, { message: 'skillId must be a valid id' })
  skillId!: string;

  @IsInt()
  @Min(1)
  difficulty!: number;
}

/** PATCH /items/:itemId — full replace of authorable fields. OCC on the Item token; owning version must still be DRAFT. */
export class UpdateItemDto {
  @IsISO8601({ strict: true }, { message: 'expectedItemUpdatedAt must be an ISO-8601 timestamp' })
  expectedItemUpdatedAt!: string;

  @IsIn(AUTHORABLE_FORMATS, { message: 'unsupported format' })
  format!: AuthorableItemFormat;

  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'prompt must not be empty' })
  @MaxLength(4000)
  prompt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemOptionDto)
  options!: ItemOptionDto[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  correctOptionIds!: string[];

  @IsUUID(undefined, { message: 'skillId must be a valid id' })
  skillId!: string;

  @IsInt()
  @Min(1)
  difficulty!: number;
}

/** DELETE /items/:itemId — carries the Item OCC token in the body. */
export class DeleteItemDto {
  @IsISO8601({ strict: true }, { message: 'expectedItemUpdatedAt must be an ISO-8601 timestamp' })
  expectedItemUpdatedAt!: string;
}

/** POST /versions/:versionId/items/reorder — full ordered id set of the version's items. OCC on the Version token. */
export class ReorderItemsDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  orderedItemIds!: string[];
}

/** POST /versions/:versionId/submit-review — content.author + scope. OCC on the Version token. */
export class SubmitReviewDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;
}

/** POST /versions/:versionId/return-draft — assessment.publish + scope. Reason mandatory. */
export class ReturnDraftDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;

  @IsString()
  @Trim()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(1000)
  reason!: string;
}

/** POST /versions/:versionId/publish — assessment.publish + scope. OCC on the Version token. */
export class PublishVersionDto {
  @IsISO8601({ strict: true }, { message: 'expectedVersionUpdatedAt must be an ISO-8601 timestamp' })
  expectedVersionUpdatedAt!: string;
}
