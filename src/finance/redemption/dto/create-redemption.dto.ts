import { IsInt, IsNotEmpty, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * Public subscription-discount redemption creation input (Phase 2.1C-2). The learner supplies ONLY the target
 * PaymentOrder, the requested IZL amount, and an idempotency key — rate/value/ceiling/policy/reservation are all
 * server-derived (§12/§65).
 */
export class CreateRedemptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  paymentOrderId!: string;

  @IsInt()
  @IsPositive()
  amountIzl!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  clientRequestId!: string;
}
