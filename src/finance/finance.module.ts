import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { FinanceController } from './finance.controller';
import { DailyMissionIzlService } from './reward/daily-mission-izl.service';
import { RewardRepository } from './reward/reward.repository';
import { IzlWalletService } from './wallet/izl-wallet.service';
import { IzlWalletRepository } from './wallet/izl-wallet.repository';
import { IzlReservationService } from './reservation/izl-reservation.service';
import { IzlReservationRepository } from './reservation/izl-reservation.repository';
import { RedemptionController } from './redemption/redemption.controller';
import { SubscriptionDiscountRedemptionService } from './redemption/subscription-discount-redemption.service';
import { RedemptionRepository } from './redemption/redemption.repository';

/**
 * Finance / IZL module (Phase 2.1A earning + 2.1B wallet/reservation + 2.1C-2 redemption). Single writer of
 * RewardGrant + IZLLedgerEntry (reward.repository), IZLWallet (izl-wallet.repository), IZLReservation
 * (izl-reservation.repository + redemption.repository), IZLRedemption (redemption.repository). Reads
 * DailyMissionCompletion / SubscriptionCycle / PaymentOrder / IzlRateVersion via its own repositories (one-way).
 * The 2.1C-2 redemption reserve/release performs no ledger debit and no PaymentOrder mutation.
 */
@Module({
  imports: [ClockModule],
  controllers: [FinanceController, RedemptionController],
  providers: [
    DailyMissionIzlService,
    RewardRepository,
    IzlWalletService,
    IzlWalletRepository,
    IzlReservationService,
    IzlReservationRepository,
    SubscriptionDiscountRedemptionService,
    RedemptionRepository,
  ],
  exports: [DailyMissionIzlService, IzlReservationService, IzlWalletService, SubscriptionDiscountRedemptionService],
})
export class FinanceModule {}
