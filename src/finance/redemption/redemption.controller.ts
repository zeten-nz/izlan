import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { SubscriptionDiscountRedemptionService } from './subscription-discount-redemption.service';
import { CreateRedemptionDto } from './dto/create-redemption.dto';

/**
 * Subscription-discount redemption API (Phase 2.1C-2). Own-user only (global AuthGuard). Create reserves IZL against
 * an own CREATED PaymentOrder (RESERVED + ACTIVE hold); release frees an unapplied redemption. No ledger debit, no
 * APPLIED/CONSUMED, no PaymentOrder mutation. The learner supplies only paymentOrderId + amountIzl + clientRequestId
 * (§12/§65); all economics are server-derived. GET is read-only. No internal rate/reservation/policy leak (§49).
 */
@Controller('izl/redemptions')
export class RedemptionController {
  constructor(private readonly service: SubscriptionDiscountRedemptionService) {}

  /** Create (or idempotently return) a RESERVED subscription-discount redemption. */
  @Post('subscription-discount')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: CreateRedemptionDto) {
    return this.service.createSubscriptionDiscount(principal.userId, dto.paymentOrderId, dto.amountIzl, dto.clientRequestId);
  }

  /** Commit an own RESERVED redemption's frozen discount onto its CREATED PaymentOrder (idempotent; no body; no
   *  IZL spend — redemption stays RESERVED, reservation stays ACTIVE, ledger unchanged). */
  @Post(':id/commit-discount')
  @HttpCode(200)
  commit(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.service.commitDiscount(principal.userId, id);
  }

  /** Own redemption snapshot (404 for another user's redemption). Read-only. */
  @Get(':id')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.service.getRedemption(principal.userId, id);
  }

  /** Release an own RESERVED redemption (idempotent; no body; no ledger movement). */
  @Post(':id/release')
  @HttpCode(200)
  release(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.service.release(principal.userId, id);
  }
}
