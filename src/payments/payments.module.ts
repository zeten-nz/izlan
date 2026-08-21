import { Module } from '@nestjs/common';
import { ClockModule } from '../common/clock.module';
import { FinanceModule } from '../finance/finance.module';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentCallbackService } from './payment-callback.service';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentFinalizationRepository } from './payment-finalization.repository';
import { PaymentFinalizationRecoveryService } from './payment-finalization-recovery.service';
import { PaymentFinalizationRecoveryRepository } from './payment-finalization-recovery.repository';
import { PaymentOrderReopenService } from './payment-order-reopen.service';
import { PaymentOrderReopenRepository } from './payment-order-reopen.repository';
import { PaymentReopenRecoveryService } from './payment-reopen-recovery.service';
import { PaymentReopenRecoveryRepository } from './payment-reopen-recovery.repository';
import { PaymentProviderBindingService } from './payment-provider-binding.service';
import { PaymentProviderBindingRepository } from './payment-provider-binding.repository';
import { PaymeProtocolService } from './payme-protocol.service';
import { PaymeProtocolRepository } from './payme-protocol.repository';
import { ClickProtocolService } from './click-protocol.service';
import { ClickProtocolRepository } from './click-protocol.repository';
import { PaymentsRepository } from './payments.repository';
import { PAYMENT_PROVIDER_PORT } from './provider/payment-provider.port';
import { UnavailablePaymentProviderAdapter } from './provider/unavailable-payment-provider.adapter';

/**
 * Payments module (Phase 2.1C-PO purchase intent + 2.1E execution + 2.1F verified evidence). Writes PaymentOrder
 * (create + CREATED→PENDING), PaymentTransaction (PENDING attempt + provider-init attach + PENDING→SUCCEEDED on a
 * trusted callback) and PaymentCallbackEvent (verified provider evidence). The payment provider port defaults to the
 * production-safe Unavailable adapter (no real Click/Payme); tests override PAYMENT_PROVIDER_PORT. Never writes PAID /
 * Subscription / Cycle / IZL / XP (§76). PaymentCallbackService has NO controller — internal/provider-facing only (§46).
 *
 * Phase 2.1L-D (TD-233..239) adds provider contract/persistence hardening — still NO real adapter/route/provider call:
 * the non-terminal provider-binding primitive (PaymentProviderBinding*) and provider-specific durable protocol
 * persistence (PaymeProtocol* fully verified from official docs; ClickProtocol* a provider-neutral shell under a
 * standing CLICK PROTOCOL VERIFICATION BLOCKER, §0). These speak provider protocol / reconstruct idempotent native
 * responses only; core economic authority stays in PaymentTransaction/PaymentOrder/IZL/Subscription (§25).
 */
@Module({
  imports: [ClockModule, FinanceModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, PaymentCallbackService, PaymentFinalizationService, PaymentFinalizationRepository, PaymentFinalizationRecoveryService, PaymentFinalizationRecoveryRepository, PaymentOrderReopenService, PaymentOrderReopenRepository, PaymentReopenRecoveryService, PaymentReopenRecoveryRepository, PaymentProviderBindingService, PaymentProviderBindingRepository, PaymeProtocolService, PaymeProtocolRepository, ClickProtocolService, ClickProtocolRepository, PaymentsRepository, { provide: PAYMENT_PROVIDER_PORT, useClass: UnavailablePaymentProviderAdapter }],
  exports: [PaymentsService, PaymentCallbackService, PaymentFinalizationService, PaymentFinalizationRecoveryService, PaymentOrderReopenService, PaymentReopenRecoveryService, PaymentProviderBindingService, PaymeProtocolService, ClickProtocolService],
})
export class PaymentsModule {}
