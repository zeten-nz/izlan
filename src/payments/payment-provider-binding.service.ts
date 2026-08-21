import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { PaymentProviderBindingRepository, ProviderBindingResult } from './payment-provider-binding.repository';

/**
 * Non-terminal provider-binding service (Phase 2.1L-D, TD-234, §17). Internal/server-owned — no controller/route is
 * exposed in this phase (§18). A FUTURE CLICK Prepare / Payme CreateTransaction handler calls this to attach the
 * provider-native transaction id to the existing PENDING PaymentTransaction before any terminal financial evidence
 * exists. It never transitions payment status and never calls a provider.
 */
@Injectable()
export class PaymentProviderBindingService {
  constructor(private readonly repo: PaymentProviderBindingRepository) {}

  bindProviderTransactionId(paymentTransactionId: string, provider: PaymentProvider, providerTransactionId: string): Promise<ProviderBindingResult> {
    return this.repo.bind(paymentTransactionId, provider, providerTransactionId);
  }
}
