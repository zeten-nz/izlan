import { NormalizedPaymentStatus, PaymentCallbackInput, PaymentInitiationInput, PaymentInitiationResult, PaymentProviderPort, VerifiedPaymentProviderEvent } from '../src/payments/provider/payment-provider.port';

/**
 * Deterministic test payment provider adapter (Phase 2.1E initiate + 2.1F/2.1I verifyCallback). Given the same stable
 * `paymentTransactionId` it returns the same logical `providerTransactionId` + checkout. `verifyCallback` normalizes a
 * fixture payload (never touches the DB). `payload.signatureValid === false` simulates a failed authentication (§9).
 * `payload.status` may be SUCCEEDED (default) / FAILED / CANCELLED; a non-success fixture is terminal unless
 * `payload.terminal === false` (the ambiguous case, §43). `payload.reasonCode` (e.g. PROVIDER_EXPIRED, §42) passes
 * through. Test-only.
 */
export class TestPaymentProviderAdapter implements PaymentProviderPort {
  /** When true, simulate an ambiguous external init failure (transport error) — see §72/§73. */
  public failMode = false;

  async initiate(input: PaymentInitiationInput): Promise<PaymentInitiationResult> {
    if (this.failMode) throw new Error('simulated ambiguous provider init failure');
    return {
      providerTransactionId: `test-${input.provider}-${input.paymentTransactionId}`, // deterministic from the stable attempt id
      checkoutUrl: `https://test.provider.local/checkout/${input.paymentTransactionId}`,
      metadata: { mode: 'test', provider: input.provider },
    };
  }

  async verifyCallback(input: PaymentCallbackInput): Promise<VerifiedPaymentProviderEvent> {
    const p = input.payload;
    if (p.signatureValid === false) throw new Error('simulated invalid provider callback signature'); // §9 — no writes
    const status = (p.status === undefined ? 'SUCCEEDED' : String(p.status)) as NormalizedPaymentStatus;
    const nonSuccess = status === 'FAILED' || status === 'CANCELLED';
    return {
      provider: input.provider,
      providerEventId: String(p.eventId),
      merchantPaymentTransactionId: String(p.merchantTransactionId),
      providerTransactionId: p.providerTransactionId === undefined ? undefined : String(p.providerTransactionId),
      status,
      terminal: p.terminal === undefined ? (nonSuccess ? true : undefined) : Boolean(p.terminal), // non-success is definitive unless explicitly non-terminal (§43)
      reasonCode: p.reasonCode === undefined ? undefined : String(p.reasonCode), // e.g. PROVIDER_EXPIRED (§42)
      amount: p.amount === undefined ? undefined : Number(p.amount),
      currency: p.currency === undefined ? undefined : String(p.currency),
      confirmedAt: new Date(p.confirmedAt ? String(p.confirmedAt) : '2026-08-20T07:00:00.000Z'),
      metadata: { mode: 'test', provider: input.provider },
    };
  }
}
