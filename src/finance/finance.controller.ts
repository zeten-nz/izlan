import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { DailyMissionIzlService } from './reward/daily-mission-izl.service';
import { IzlWalletService } from './wallet/izl-wallet.service';

/**
 * IZL API (Phase 2.1A + 2.1B). Own-user only (global AuthGuard). GET returns the canonical {balance, reserved,
 * available} derived from the ledger + ACTIVE reservations — read-only, never trusts/writes the wallet cache
 * (§38/§39). Reconcile materializes missing mission IZL + rebuilds the wallet projection. No manual claim /
 * grant-creation / no learner reservation create/release endpoint (§16/§88); no client-supplied amount/cycle/
 * policy/dedup/reservation fields (§89). Earning + read only — no redemption/payment (§60/§58). No evidence/policy leak.
 */
@Controller('izl')
export class FinanceController {
  constructor(
    private readonly izl: DailyMissionIzlService,
    private readonly wallet: IzlWalletService,
  ) {}

  /** Canonical {balanceIzl, reservedIzl, availableIzl}. Zero state → 200 {0,0,0} (not 404); never creates a wallet row. */
  @Get('me')
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.wallet.getBalances(principal.userId);
  }

  /** Materialize any missing mission IZL + rebuild the wallet projection for this learner (idempotent; no body). */
  @Post('me/reconcile')
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.izl.reconcile(principal.userId);
  }
}
