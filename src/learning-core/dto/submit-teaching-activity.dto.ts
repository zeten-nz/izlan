import { IsDefined, IsObject, IsUUID } from 'class-validator';

/**
 * POST /v2/teaching-sessions/:sessionId/activities/:activityId/attempts.
 *
 * Mirrors the V1 lesson-execution contract: `clientRequestId` is REQUIRED (durable retry-dedup identity);
 * a network retry reuses the same id (idempotent replay), an intentional re-attempt uses a NEW id (new
 * evidence row). The server owns all scoring/attemptNo authority. `answer` is a camelCase object validated
 * server-side by the reused ObjectiveActivityScorerService; forbidNonWhitelisted rejects any injected field.
 */
export class SubmitTeachingActivityDto {
  @IsUUID()
  clientRequestId!: string;

  @IsDefined()
  @IsObject()
  answer!: Record<string, unknown>;
}
