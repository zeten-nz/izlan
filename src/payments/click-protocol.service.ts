import { Injectable } from '@nestjs/common';
import { ClickShopTransaction } from '@prisma/client';
import { Clock } from '../common/clock';
import { ClickProtocolRepository, ClickProtocolResult } from './click-protocol.repository';

/**
 * CLICK Shop API protocol service (Phase 2.1L-D, TD-233/235). Owns the injected Clock so Prepare/Complete acceptance
 * timestamps come from `Clock.now()` (§12 — sign_time is never the economic timestamp authority). Internal/server-owned;
 * no controller/route/provider call in this phase. Under the standing CLICK PROTOCOL VERIFICATION BLOCKER (§0) it only
 * persists replay-stable protocol state — the real signature/amount/error/generation logic is Phase 2.1L-C.
 */
@Injectable()
export class ClickProtocolService {
  constructor(
    private readonly repo: ClickProtocolRepository,
    private readonly clock: Clock,
  ) {}

  prepare(input: { paymentTransactionId: string; clickTransId: string; merchantPrepareId: string }): Promise<ClickProtocolResult> {
    return this.repo.recordPrepare({ ...input, now: this.clock.now() });
  }

  complete(input: { paymentTransactionId: string; merchantConfirmId: string; accepted: boolean }): Promise<ClickProtocolResult> {
    return this.repo.recordComplete({ ...input, now: this.clock.now() });
  }

  getByPaymentTransaction(paymentTransactionId: string): Promise<ClickShopTransaction | null> {
    return this.repo.getByPaymentTransaction(paymentTransactionId);
  }
}
