import { Injectable, Logger } from '@nestjs/common';
import { IzlWalletRepository } from './izl-wallet.repository';
import { computeIzlBalance, IzlBalance } from './izl-balance.engine';

/**
 * IZL wallet projection service (Phase 2.1B). The ONLY IZLWallet writer (§10). Learner-facing balances are derived
 * canonically from ledger + ACTIVE reservations (never trust the cache, §23/§38). The projection is a rebuildable
 * cache repaired by recompute/reconcile; a projection failure never rolls back ledger/reservations (§13, TD-160).
 */
@Injectable()
export class IzlWalletService {
  private readonly logger = new Logger('IzlWallet');

  constructor(private readonly repo: IzlWalletRepository) {}

  /** Canonical {balance, reserved, available} from the authoritative sources (§37/§38). Read-only. */
  async getBalances(userId: string): Promise<IzlBalance> {
    const [ledger, reserved] = await Promise.all([this.repo.ledgerBalance(userId), this.repo.activeReservedTotal(userId)]);
    return computeIzlBalance(ledger, reserved);
  }

  /** Rebuild the wallet projection from canonical sources (§11). */
  async recompute(userId: string): Promise<void> {
    await this.repo.recomputeWallet(userId);
  }

  /** Downstream projection refresh that never throws (§13/§49 — authoritative ops must not roll back on cache failure). */
  async tryRecompute(userId: string): Promise<void> {
    try {
      await this.repo.recomputeWallet(userId);
    } catch {
      this.logger.warn(`izl wallet projection recompute deferred for user ${userId}`); // reconcile/next op repairs it
    }
  }
}
