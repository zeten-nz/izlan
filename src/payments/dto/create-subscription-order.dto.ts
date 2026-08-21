import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Public subscription purchase-order creation input (Phase 2.1C-PO). The learner supplies ONLY the plan and an
 * idempotency key — all economics (price, discount, payable, purpose, provider) are server-derived (§26/§4).
 */
export class CreateSubscriptionOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  planId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  clientRequestId!: string;
}
