import { IsDefined, IsObject, IsUUID } from 'class-validator';

/**
 * POST /lesson-executions/:lessonId/activities/:activityId/attempts.
 *
 * `clientRequestId` is REQUIRED (§15): it is the durable retry-dedup identity (ux_attempt_client_request).
 * The client owns request identity — a network retry reuses the same id (idempotent); an intentional
 * re-attempt uses a NEW id (new evidence row). The server never generates it.
 *
 * `answer` is a camelCase object validated server-side by the scorer. forbidNonWhitelisted rejects any
 * injected top-level field (score/isCorrect/attemptNo/lessonRevisionId…), §44.
 */
export class SubmitActivityAttemptDto {
  @IsUUID()
  clientRequestId!: string;

  @IsDefined()
  @IsObject()
  answer!: Record<string, unknown>;
}
