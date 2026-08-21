import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { PaymeProtocolRepository, PaymeProtocolResult, PaymeReconstructed } from './payme-protocol.repository';

/**
 * Payme Merchant API protocol service (Phase 2.1L-D, TD-235). Owns the injected Clock so every merchant-assigned
 * timestamp (create_time / perform_time / cancel_time) is `Clock.now()` converted to an integer Unix-millisecond BigInt
 * (§5). The FIRST accepted PerformTransaction's perform_time is the instant a future adapter will also stamp onto
 * `PaymentTransaction.confirmedAt`; because the repository sets each timestamp once, replay preserves the original
 * instant. Internal/server-owned — no controller/route/provider call in this phase (§18/§19).
 */
@Injectable()
export class PaymeProtocolService {
  constructor(
    private readonly repo: PaymeProtocolRepository,
    private readonly clock: Clock,
  ) {}

  private nowMs(): bigint {
    return BigInt(this.clock.now().getTime());
  }

  createTransaction(input: { paymentTransactionId: string; paymeTransactionId: string; providerCreatedTimeMs: bigint; amountTiyin: bigint; accountSnapshot: Prisma.InputJsonValue }): Promise<PaymeProtocolResult> {
    return this.repo.recordCreate({ ...input, nowMs: this.nowMs() });
  }

  performTransaction(paymeTransactionId: string): Promise<PaymeProtocolResult> {
    return this.repo.recordPerform(paymeTransactionId, this.nowMs());
  }

  cancelTransaction(paymeTransactionId: string, reason: number): Promise<PaymeProtocolResult> {
    return this.repo.recordCancel(paymeTransactionId, reason, this.nowMs());
  }

  checkTransaction(paymeTransactionId: string): Promise<PaymeReconstructed | null> {
    return this.repo.checkTransaction(paymeTransactionId);
  }

  getStatement(fromMs: bigint, toMs: bigint): Promise<PaymeReconstructed[]> {
    return this.repo.getStatement(fromMs, toMs);
  }
}
