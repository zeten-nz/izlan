import { Injectable, Logger } from '@nestjs/common';
import { PaymentOrderReopenRepository, PaymentReopenResult } from './payment-order-reopen.repository';

/**
 * Payment order reopen / retry service (Phase 2.1J). Internal/server-owned — there is NO learner reopen route (§4/§61).
 * A definitively terminal (FAILED/CANCELLED) attempt makes its own PENDING order retryable again (PENDING → CREATED);
 * the learner then retries via the existing `POST /api/payments/orders/:id/initiate` with a fresh clientRequestId
 * (§29/§42 — reopen never auto-creates a new attempt or calls a provider).
 */
@Injectable()
export class PaymentOrderReopenService {
  private readonly logger = new Logger('PaymentOrderReopen');

  constructor(private readonly repo: PaymentOrderReopenRepository) {}

  /** Reopen the order behind a terminal attempt (authority = the terminal PaymentTransaction.id only). */
  reopenAfterTerminalAttempt(paymentTransactionId: string): Promise<PaymentReopenResult> {
    return this.repo.reopen(paymentTransactionId);
  }

  /** Post-non-success bridge (§24/§25): best-effort reopen after the 2.1I terminal callback has COMMITTED. Never throws —
   *  a reopen failure leaves the terminal PT + PENDING order recoverable and never touches the provider evidence (§26). */
  async tryReopenAfterTerminal(paymentTransactionId: string): Promise<void> {
    try {
      await this.repo.reopen(paymentTransactionId);
    } catch {
      this.logger.warn(`payment order reopen deferred for transaction ${paymentTransactionId}`); // recoverable; provider evidence intact
    }
  }
}
