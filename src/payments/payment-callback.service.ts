import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import { Clock } from '../common/clock';
import { PaymentCallbackVerificationError } from '../common/errors';
import { PaymentCallbackOutcome, PaymentsRepository } from './payments.repository';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentOrderReopenService } from './payment-order-reopen.service';
import { PAYMENT_PROVIDER_PORT, PaymentCallbackInput, PaymentProviderPort, VerifiedPaymentProviderEvent } from './provider/payment-provider.port';

/**
 * Verified payment evidence pipeline (Phase 2.1F, payment-verified-evidence-v1). Narrow ownership in the payments
 * module (§38): resolve the provider adapter → verify the callback OUTSIDE any DB transaction (§39) → normalize →
 * authoritative DB processing (dedup + PENDING→SUCCEEDED). It produces the durable trusted-success marker
 * (PaymentTransaction.status = SUCCEEDED) but does NOT finalize business state: PaymentOrder stays PENDING, no IZL
 * debit, no Subscription/Cycle (§31/§32). There is NO learner route — only trusted provider verification can produce
 * success evidence (§45). Real Click/Payme adapters + webhook controllers remain deferred (§8/§46).
 */
@Injectable()
export class PaymentCallbackService {
  private readonly logger = new Logger('PaymentCallback');

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly clock: Clock,
    private readonly finalization: PaymentFinalizationService,
    private readonly reopen: PaymentOrderReopenService,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  /** Provider-facing entry point (future Click/Payme controllers call this). Envelope is opaque input for the adapter (§5). */
  async processProviderCallback(provider: PaymentProvider, input: PaymentCallbackInput): Promise<PaymentCallbackOutcome> {
    // 1. adapter authentication/verification — OUTSIDE any DB transaction (§39). Failure ⇒ zero business writes (§10).
    let verified: VerifiedPaymentProviderEvent;
    try {
      verified = await this.provider.verifyCallback({ ...input, provider });
    } catch {
      this.logger.warn(`provider callback verification rejected for ${provider}`); // never log payloads/secrets (§13/§75)
      throw new PaymentCallbackVerificationError('provider callback verification failed');
    }
    // 2. normalized-shape integrity (§3/§10) — a malformed / non-terminal / unsupported result is an unverified callback.
    this.assertVerifiedEvent(provider, verified);
    // 3a. SUCCESS path (Phase 2.1F): authoritative DB processing under the payment-scoped lock; then the 2.1G bridge.
    if (verified.status === 'SUCCEEDED') {
      const outcome = await this.repo.recordVerifiedCallback(verified, this.clock.now());
      // Phase 2.1G bridge: after SUCCEEDED evidence is durably committed, best-effort finalization in a SEPARATE
      // transaction (§63 — never nested). Never throws; a matching replay may retry a stuck finalization (§64/§65).
      if (outcome.transactionStatus === PaymentTransactionStatus.SUCCEEDED && outcome.paymentTransactionId) {
        await this.finalization.tryFinalizeAfterVerification(outcome.paymentTransactionId);
      }
      return outcome;
    }
    // 3b. NON-SUCCESS path (Phase 2.1I): trusted definitive FAILED/CANCELLED → PT terminal transition (order stays
    //     PENDING; no finalization bridge). The 2.1J reopen bridge then runs in a SEPARATE transaction (§24).
    const outcome = await this.repo.recordTerminalNonSuccess(verified, verified.status, this.clock.now());
    // 4. Phase 2.1J reopen bridge — only for accepted/matching terminal evidence (never a conflict/mismatch, §28). Runs
    //    AFTER the terminal evidence has committed (§24); non-throwing — a reopen failure never touches the evidence (§25).
    const terminal = outcome.transactionStatus === PaymentTransactionStatus.FAILED || outcome.transactionStatus === PaymentTransactionStatus.CANCELLED;
    if ((outcome.outcome === 'ACCEPTED' || outcome.outcome === 'DUPLICATE') && terminal && outcome.paymentTransactionId) {
      await this.reopen.tryReopenAfterTerminal(outcome.paymentTransactionId);
    }
    return outcome;
  }

  private assertVerifiedEvent(provider: PaymentProvider, v: VerifiedPaymentProviderEvent): void {
    const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim() !== '';
    if (v.provider !== provider) throw new PaymentCallbackVerificationError('verified provider mismatch');
    if (!nonEmpty(v.providerEventId) || !nonEmpty(v.merchantPaymentTransactionId)) throw new PaymentCallbackVerificationError('malformed verified event'); // §10/§11
    if (!UUID_RE.test(v.merchantPaymentTransactionId)) throw new PaymentCallbackVerificationError('malformed merchant transaction id'); // §10 — a non-UUID identity can never be ours
    if (v.status !== 'SUCCEEDED' && v.status !== 'FAILED' && v.status !== 'CANCELLED') throw new PaymentCallbackVerificationError('unsupported verified status'); // §3/§10
    if (v.status === 'SUCCEEDED') {
      // SUCCESS requires exact amount/currency + external identity (§14 asymmetry).
      if (!nonEmpty(v.providerTransactionId) || !nonEmpty(v.currency)) throw new PaymentCallbackVerificationError('malformed verified event');
      if (!Number.isInteger(v.amount) || (v.amount ?? 0) <= 0) throw new PaymentCallbackVerificationError('invalid verified amount');
    } else if (v.terminal !== true) {
      // FAILED/CANCELLED must be DEFINITIVE (§4). Ambiguous/non-terminal ⇒ unsupported → zero writes, PT stays PENDING (§5/§43).
      throw new PaymentCallbackVerificationError('non-terminal provider non-success is not accepted');
    }
    if (!(v.confirmedAt instanceof Date) || Number.isNaN(v.confirmedAt.getTime())) throw new PaymentCallbackVerificationError('invalid confirmed timestamp');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
