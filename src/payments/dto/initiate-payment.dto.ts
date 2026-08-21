import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PaymentProvider } from '@prisma/client';

/**
 * Public payment initiation input (Phase 2.1E). The learner supplies ONLY the provider and an idempotency key —
 * amount/currency/status/providerTransactionId/payable are all server-derived (§4/§79).
 */
export class InitiatePaymentDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  clientRequestId!: string;
}
