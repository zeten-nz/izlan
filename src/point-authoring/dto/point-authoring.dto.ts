import { BlueprintBindingRole, ContentReviewOutcome, EvidenceIntegrityOutcome, SkillContributionRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const ISO = { message: 'expectedUpdatedAt must be an ISO-8601 timestamp' };

export class CreatePointDto {
  @IsString() @MinLength(3) @MaxLength(120) pointKey!: string; // stable business key (like Lesson.contentKey)
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(300, { each: true }) canDo?: string[];
  @IsInt() @Min(0) sortOrderDefault!: number;
  @IsOptional() @IsInt() @Min(0) @Max(600) estimatedEffortMin?: number;
}

export class UpdatePointRevisionDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(300, { each: true }) canDo?: string[];
  @IsOptional() @IsInt() @Min(0) sortOrderDefault?: number;
  @IsOptional() @IsInt() @Min(0) @Max(600) estimatedEffortMin?: number;
}

export class PointSkillDto {
  @IsUUID() skillId!: string;
  @IsEnum(SkillContributionRole) role!: SkillContributionRole;
}
export class SetPointSkillsDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PointSkillDto) skills!: PointSkillDto[];
}

export class SetPointPrerequisitesDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsArray() @IsUUID('all', { each: true }) prerequisitePointIds!: string[];
}

export class BlueprintBindingDto {
  @IsUUID() activityId!: string;
  @IsEnum(BlueprintBindingRole) role!: BlueprintBindingRole;
}
export class BlueprintStageDto {
  @IsOptional() @IsString() @MaxLength(120) stageKey?: string;
  @IsString() @MinLength(1) @MaxLength(60) stageType!: string; // registry: concept/recognition/production/mastery/...
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BlueprintBindingDto) bindings!: BlueprintBindingDto[];
}
export class SetBlueprintStagesDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BlueprintStageDto) stages!: BlueprintStageDto[];
}

export class MasterySkillGateDto {
  @IsUUID() skillId!: string;
  @IsEnum(SkillContributionRole) role!: SkillContributionRole;
  @IsArray() @IsString({ each: true }) @ArrayNotEmpty() requiredEvidenceKinds!: string[];
  @IsOptional() @IsInt() @Min(0) @Max(5) minIndependence?: number;
}
export class MasteryGatesDto {
  @IsInt() @Min(0) @Max(10000) thresholdBp!: number;
  @IsInt() @Min(0) @Max(5) minIndependence!: number;
  @IsOptional() requireAllRequiredSkills?: boolean;
}
export class SetMasteryDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @ValidateNested() @Type(() => MasteryGatesDto) gates!: MasteryGatesDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MasterySkillGateDto) skillGates!: MasterySkillGateDto[];
}

export class CreateSourceDto {
  @IsString() @MinLength(2) @MaxLength(300) title!: string;
  @IsString() @MinLength(2) @MaxLength(60) kind!: string;
  @IsOptional() @IsString() @MaxLength(500) locator?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
export class AttachSourceDto {
  @IsUUID() sourceReferenceId!: string;
  @IsString() @MinLength(2) @MaxLength(60) claimRole!: string;
}

export class RaiseIssueDto {
  @IsString() @MinLength(2) @MaxLength(30) severityCode!: string; // BLOCKER / MAJOR / MINOR
  @IsString() @MinLength(2) @MaxLength(1000) summary!: string;
  // typed XOR target (only one)
  @IsOptional() @IsUUID() roadmapPointRevisionId?: string;
  @IsOptional() @IsUUID() activityId?: string;
  @IsOptional() @IsUUID() assessmentItemId?: string;
}
export class ResolveIssueDto {
  @IsString() @IsEnum({ RESOLVED: 'RESOLVED', DISMISSED: 'DISMISSED', UNDER_REVIEW: 'UNDER_REVIEW' }) status!: 'RESOLVED' | 'DISMISSED' | 'UNDER_REVIEW';
}

export class SubmitPointReviewDto {
  @IsString(ISO) expectedUpdatedAt!: string;
}
export class ReturnPointToDraftDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class ReviewPointDto {
  @IsString(ISO) expectedUpdatedAt!: string;
  @IsEnum(ContentReviewOutcome) outcome!: ContentReviewOutcome;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class PublishPointDto {
  @IsString(ISO) expectedUpdatedAt!: string;
}

export class IntegrityScopeDto {
  @IsString() @MinLength(2) @MaxLength(60) scopeKind!: string;
  @IsOptional() @IsUUID() activityId?: string;
  @IsOptional() @IsUUID() assessmentItemId?: string;
  @IsOptional() @IsUUID() lessonRevisionId?: string;
  @IsOptional() @IsObject() scopeQualifier?: Record<string, unknown>;
}
export class RecordIntegrityDecisionDto {
  @IsUUID() clientRequestId!: string; // command idempotency (no natural key)
  @IsEnum(EvidenceIntegrityOutcome) outcome!: EvidenceIntegrityOutcome;
  @IsString() @MinLength(2) @MaxLength(60) reasonCode!: string;
  @IsOptional() @IsUUID() contentQualityIssueId?: string;
  @IsOptional() @IsUUID() supersedesDecisionId?: string;
  @IsOptional() @IsObject() details?: Record<string, unknown>;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => IntegrityScopeDto) scopes!: IntegrityScopeDto[];
}
