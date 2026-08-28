import { IsUUID } from 'class-validator';

/**
 * POST /v2/placement/subjects/:subjectId/from-zero.
 * `clientRequestId` is the durable idempotency key: a retry reuses the same id (returns the same decision),
 * a deliberate re-run uses a new id. The server owns the decision/roadmap; no learner economic authority.
 */
export class FromZeroDto {
  @IsUUID()
  clientRequestId!: string;
}
