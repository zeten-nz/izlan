import { Injectable, Logger } from '@nestjs/common';
import { IzlWalletService } from '../finance/wallet/izl-wallet.service';
import { FinalizationResult, PaymentFinalizationRepository } from './payment-finalization.repository';

/**
 * Verified payment economic finalization service (Phase 2.1G). Internal/server-owned — there is NO learner endpoint to
 * mark an order paid or activate a subscription (§3/§67/§101). It runs the one atomic finalization transaction, then
 * (discounted only) triggers a downstream, non-throwing IZL wallet recompute (§60/§61) — a projection failure never
 * rolls back the committed PAID / Subscription / Cycle / REDEEM / CONSUMED / APPLIED state.
 */
@Injectable()
export class PaymentFinalizationService {
  private readonly logger = new Logger('PaymentFinalization');

  constructor(
    private readonly repo: PaymentFinalizationRepository,
    private readonly wallet: IzlWalletService,
  ) {}

  /** Finalize a trusted SUCCEEDED payment into a paid subscription. Authority = the persisted transaction id only. */
  async finalizeVerifiedPayment(paymentTransactionId: string): Promise<FinalizationResult> {
    const result = await this.repo.finalize(paymentTransactionId);
    if (result.discounted) await this.wallet.tryRecompute(result.userId); // §60 downstream cache repair; ledger + ACTIVE reservations stay canonical
    return result;
  }

  /** Post-verification bridge (§63/§64): best-effort finalize a freshly-trusted SUCCEEDED transaction. Never throws —
   *  a finalization failure leaves recoverable SUCCEEDED + PENDING state and never touches the verified-payment evidence. */
  async tryFinalizeAfterVerification(paymentTransactionId: string): Promise<void> {
    try {
      await this.finalizeVerifiedPayment(paymentTransactionId);
    } catch {
      this.logger.warn(`payment finalization deferred for transaction ${paymentTransactionId}`); // recoverable via SUCCEEDED+PENDING backlog (§68)
    }
  }
}
