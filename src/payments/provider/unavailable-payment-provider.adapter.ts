import { Injectable } from '@nestjs/common';
import { PaymentProviderUnavailableError } from '../../common/errors';
import { PaymentCallbackInput, PaymentInitiationInput, PaymentInitiationResult, PaymentProviderPort, VerifiedPaymentProviderEvent } from './payment-provider.port';

/**
 * Production-safe default payment provider adapter (Phase 2.1E initiate + 2.1F verifyCallback, §22/§48). No real
 * Click/Payme integration exists yet, so both initiation and callback verification are refused rather than faked.
 * The initiate service catches the failure and leaves the attempt PENDING for retry (§30); a refused verifyCallback
 * performs zero business writes (§48).
 */
@Injectable()
export class UnavailablePaymentProviderAdapter implements PaymentProviderPort {
  initiate(_input: PaymentInitiationInput): Promise<PaymentInitiationResult> {
    throw new PaymentProviderUnavailableError('payment provider not configured');
  }

  verifyCallback(_input: PaymentCallbackInput): Promise<VerifiedPaymentProviderEvent> {
    throw new PaymentProviderUnavailableError('payment provider not configured');
  }
}
