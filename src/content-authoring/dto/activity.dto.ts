import { ArrayNotEmpty, IsArray, IsDefined, IsEnum, IsInt, IsObject, IsUUID, Max, Min } from 'class-validator';
import { ActivityType } from '@prisma/client';
import { OptionalPresent, RevisionEditDto } from './common.dto';

const MAX_DURATION_MIN = 100_000; // abuse bound (implementation detail)

/**
 * POST /staff/content/revisions/:revisionId/activities. `payload` is an opaque object validated by the canonical
 * authoring dispatcher (registry payloadContract), NOT by class-validator. Server owns `source`=HUMAN and
 * `aiMetadata`=null; `source`/`aiMetadata`/`lessonRevisionId`/`createdAt`/`updatedAt` are rejected 400 (whitelist).
 * `type` cannot change later — wrong type = delete + recreate (§14).
 */
export class CreateActivityDto extends RevisionEditDto {
  @IsEnum(ActivityType, { message: 'unknown activity type' })
  type!: ActivityType;

  @IsInt() @Min(0)
  position!: number;

  @IsDefined() @IsObject({ message: 'payload must be an object' })
  payload!: Record<string, unknown>;

  @OptionalPresent() @IsInt() @Min(0) @Max(MAX_DURATION_MIN)
  estimatedDurationMin?: number;
}

/**
 * PATCH /staff/content/activities/:activityId — payload + estimatedDurationMin only. `type` and `position` are NOT
 * ordinary PATCH fields (§14): type is immutable (delete+recreate); position changes only via the reorder endpoint.
 */
export class UpdateActivityDto extends RevisionEditDto {
  @OptionalPresent() @IsObject({ message: 'payload must be an object' })
  payload?: Record<string, unknown>;

  @OptionalPresent() @IsInt() @Min(0) @Max(MAX_DURATION_MIN)
  estimatedDurationMin?: number;
}

/** DELETE /staff/content/activities/:activityId — carries the revision concurrency token in the body. */
export class DeleteActivityDto extends RevisionEditDto {}

/** PUT /staff/content/revisions/:revisionId/activities/order — the full ordered id set of the revision (§16). */
export class ReorderActivitiesDto extends RevisionEditDto {
  @IsArray() @ArrayNotEmpty() @IsUUID(undefined, { each: true, message: 'orderedActivityIds must be ids' })
  orderedActivityIds!: string[];
}
