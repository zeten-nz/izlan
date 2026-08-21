import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/http/decorators';
import { PaymentFinalizationRecoveryService } from './payment-finalization-recovery.service';
import { PaymentReopenRecoveryService } from './payment-reopen-recovery.service';
import { PAYMENT_FINALIZATION_READ, PAYMENT_FINALIZATION_RECONCILE } from './finalization-recovery.constants';
import { PAYMENT_REOPEN_READ, PAYMENT_REOPEN_RECONCILE } from './reopen-recovery.constants';
import { FinalizationBacklogQueryDto, ReconcileFinalizationDto } from './dto/reconcile-finalization.dto';
import { ReconcileReopenDto, ReopenBacklogQueryDto } from './dto/reconcile-reopen.dto';

/**
 * Admin payment recovery (Phase 2.1H finalization + 2.1K reopen). Internal/operational — NOT learner-facing
 * (§12/§18/TD-213/TD-230). Guarded by dedicated admin permissions (global AuthGuard + PermissionsGuard); no ADMIN
 * role-name bypass. GETs are read-only; POSTs trigger bounded reconciliation that reuses the existing
 * PaymentFinalizationService / PaymentOrderReopenService (no provider call, no re-charge, no second business writer).
 */
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly finalizationRecovery: PaymentFinalizationRecoveryService,
    private readonly reopenRecovery: PaymentReopenRecoveryService,
  ) {}

  // ── Phase 2.1H — finalization recovery (SUCCEEDED transaction + PENDING order) ──

  /** Read-only finalization backlog. */
  @Get('finalization-backlog')
  @RequirePermissions(PAYMENT_FINALIZATION_READ)
  finalizationBacklog(@Query() query: FinalizationBacklogQueryDto) {
    return this.finalizationRecovery.listBacklog(query.limit);
  }

  /** Trigger bounded, oldest-first reconciliation of the trusted-but-unfinalized backlog. */
  @Post('finalization-reconcile')
  @RequirePermissions(PAYMENT_FINALIZATION_RECONCILE)
  finalizationReconcile(@Body() dto: ReconcileFinalizationDto) {
    return this.finalizationRecovery.reconcile(dto.limit);
  }

  // ── Phase 2.1K — reopen recovery (terminal FAILED/CANCELLED attempt + still-PENDING order) ──

  /** Read-only reopen backlog (stuck: terminal attempt exists, no live/success attempt, order never reopened). */
  @Get('reopen-backlog')
  @RequirePermissions(PAYMENT_REOPEN_READ)
  reopenBacklog(@Query() query: ReopenBacklogQueryDto) {
    return this.reopenRecovery.listBacklog(query.limit);
  }

  /** Trigger bounded, oldest-first reopen reconciliation (delegates to the existing PaymentOrderReopenService). */
  @Post('reopen-reconcile')
  @RequirePermissions(PAYMENT_REOPEN_RECONCILE)
  reopenReconcile(@Body() dto: ReconcileReopenDto) {
    return this.reopenRecovery.reconcile(dto.limit);
  }
}
