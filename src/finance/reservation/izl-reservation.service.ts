import { Injectable } from '@nestjs/common';
import { IzlReservationRepository, ReservationInput } from './izl-reservation.repository';
import { IzlWalletService } from '../wallet/izl-wallet.service';

/**
 * IZL reservation primitive (Phase 2.1B, TD-158/159). **Internal trusted service only** — there is no learner-facing
 * create/release endpoint (§16/§88). A reservation is a temporary hold against available IZL for a FUTURE trusted
 * spend/redemption workflow: it does not debit the ledger, is not a RewardGrant, is not a redemption. Reserve/release
 * are authoritative; the wallet projection is refreshed downstream (best-effort, §48/§49). Consume is NOT
 * implemented in v1 (a consumed hold must be tied atomically to a SPEND ledger debit — future phase, §29).
 */
@Injectable()
export class IzlReservationService {
  constructor(
    private readonly repo: IzlReservationRepository,
    private readonly wallet: IzlWalletService,
  ) {}

  /** Create (or idempotently return) an ACTIVE hold. Throws on insufficient available / idempotency conflict. */
  async reserve(input: ReservationInput) {
    const reservation = await this.repo.createReservation(input);
    await this.wallet.tryRecompute(input.userId); // §48 downstream projection refresh
    return reservation;
  }

  /** Release an ACTIVE hold (ACTIVE → RELEASED; idempotent). Creates no ledger movement (§26/§36). */
  async release(userId: string, reservationId: string) {
    const reservation = await this.repo.release(userId, reservationId);
    await this.wallet.tryRecompute(userId);
    return reservation;
  }
}
