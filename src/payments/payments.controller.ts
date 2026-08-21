import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/http/decorators';
import type { AuthPrincipal } from '../auth/http/principal';
import { PaymentsService } from './payments.service';
import { CreateSubscriptionOrderDto } from './dto/create-subscription-order.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

/**
 * Payments API (Phase 2.1C-PO). Own-user only (global AuthGuard). Creates a provider-agnostic subscription purchase
 * order (CREATED, immutable pricing snapshot) — no provider execution, no Subscription, no IZL. GET is read-only.
 * The learner supplies only planId + clientRequestId; everything economic is server-derived (§4/§26).
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  /** Create (or idempotently return) a subscription purchase order for the current learner. */
  @Post('subscription-orders')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() dto: CreateSubscriptionOrderDto) {
    return this.service.createSubscriptionOrder(principal.userId, dto.planId, dto.clientRequestId);
  }

  /** Own purchase order (immutable snapshot; 404 for another user's order). Read-only. */
  @Get('orders/:id')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.service.getOrder(principal.userId, id);
  }

  /** Initiate a provider payment execution attempt for an own CREATED order (order → PENDING; not payment success). */
  @Post('orders/:id/initiate')
  initiate(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string, @Body() dto: InitiatePaymentDto) {
    return this.service.initiate(principal.userId, id, dto.provider, dto.clientRequestId);
  }
}
