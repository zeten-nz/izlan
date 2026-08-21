import { PaymentProvider } from '@prisma/client';

/**
 * Payment provider PORT (Phase 2.1E initiate + 2.1F verifyCallback — mirrors the SMS_PORT pattern). Provider-neutral
 * abstraction for one provider execution attempt AND for verifying a provider callback. Vendor types never leak past
 * this boundary (no raw Prisma models / IZL objects / Subscription / client-controlled amount); the adapter owns all
 * provider-specific signature/auth verification, payload parsing, status mapping and identity extraction (§4). Real
 * Click/Payme adapters are OUT of scope (§8) — only a Test adapter and a production-safe Unavailable adapter exist.
 */
export const PAYMENT_PROVIDER_PORT = Symbol('PAYMENT_PROVIDER_PORT');

export interface PaymentInitiationInput {
  provider: PaymentProvider;
  paymentTransactionId: string; // stable internal attempt id — the merchant/idempotency reference (§21/§29)
  paymentOrderId: string;
  amount: number; // = PaymentOrder.payableAmount
  currency: string; // = PaymentOrder.currency
}

export interface PaymentInitiationResult {
  providerTransactionId: string; // non-empty on success (§20)
  checkoutUrl?: string | null;
  metadata?: Record<string, unknown> | null; // sanitized, bounded, non-authoritative
}

/**
 * Transport-neutral callback envelope (Phase 2.1F, §5). The business layer treats `payload`/`headers`/`query` as
 * OPAQUE input handed to the adapter — it never parses Click/Payme semantics. Never persist raw headers/secrets.
 */
export interface PaymentCallbackInput {
  provider: PaymentProvider;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/** Canonical normalized provider outcome (Phase 2.1I §3). Provider-specific statuses never leak past the adapter. */
export type NormalizedPaymentStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/**
 * Normalized TRUSTED provider event (Phase 2.1F success + 2.1I non-success). Emitted only after the adapter
 * authenticates the callback. `merchantPaymentTransactionId` is our stable PaymentTransaction.id supplied at initiation
 * (§7 — the primary internal identity; never resolve by amount/user guessing). `providerTransactionId` is the external
 * identity. For **FAILED / CANCELLED** the adapter MUST set `terminal = true`, meaning this exact provider transaction
 * can no longer normally become payable (§4/§24); ambiguous transport/timeout/no-response must NOT be normalized as a
 * terminal non-success — leave the transaction PENDING (§5). `amount`/`currency`/`providerTransactionId` are required
 * for SUCCEEDED but MAY be absent on a non-success event (§14/§54); `reasonCode` carries a stable classification such as
 * PROVIDER_EXPIRED (§8). SUCCEEDED still requires exact amount/currency equality downstream.
 */
export interface VerifiedPaymentProviderEvent {
  provider: PaymentProvider;
  providerEventId: string;
  merchantPaymentTransactionId: string;
  providerTransactionId?: string; // required for SUCCEEDED; may be absent on a non-success event
  status: NormalizedPaymentStatus;
  terminal?: boolean; // MUST be true for FAILED/CANCELLED (definitive); SUCCEEDED is inherently terminal
  reasonCode?: string; // stable safe classification, e.g. PROVIDER_EXPIRED
  amount?: number; // required for SUCCEEDED; optional for non-success (§14)
  currency?: string;
  confirmedAt: Date; // trusted provider-confirmed timestamp (success time; non-authoritative for non-success)
  metadata?: Record<string, unknown> | null; // sanitized, bounded, non-authoritative
}

export interface PaymentProviderPort {
  initiate(input: PaymentInitiationInput): Promise<PaymentInitiationResult>;
  /** Authenticate + normalize a provider callback OUTSIDE any DB transaction (§39). Throws on invalid/unverifiable input (§10). */
  verifyCallback(input: PaymentCallbackInput): Promise<VerifiedPaymentProviderEvent>;
}
