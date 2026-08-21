import { IsDefined, IsObject, IsUUID } from 'class-validator';

/**
 * POST /api/assessments/attempts/:attemptId/responses.
 *
 * `answer` is a type-specific camelCase object (OD/§2): `{selectedOptionId}` or `{selectedOptionIds:[...]}`.
 * Its INTERNAL shape is validated server-side by ObjectiveScorerService, not here — that is where
 * unknown/injected fields inside `answer` and duplicate option ids are rejected (§3/26/57).
 * forbidNonWhitelisted rejects any injected TOP-LEVEL field (score, points, itemDifficulty…).
 *
 * NO `clientRequestId` (§4): the schema has no such column, so accepting it would imply a persistent
 * idempotency guarantee that does not exist. Idempotency is enforced structurally instead — the
 * presented-row + atomic status transition + canonical-answer replay/conflict (see AssessmentService).
 * A durable client-request idempotency key, if ever needed, is a future schema/architecture decision.
 */
export class SubmitResponseDto {
  @IsUUID()
  itemId!: string;

  @IsDefined()
  @IsObject()
  answer!: Record<string, unknown>;
}
