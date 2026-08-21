/**
 * Centralized provider TERMINAL-callback event-id formatting (Phase 2.1L-D, §9/§15). These are the FUTURE
 * `PaymentCallbackEvent.providerEventId` values a real adapter will use for F-19 dedup when it records TERMINAL
 * financial evidence (success / definitive non-success). They are defined and unit-tested here so the exact string
 * shape is frozen in one place — no adapter re-invents it.
 *
 * Key protocol facts (verified recon, TD-233..237):
 *  - A provider transaction moves through several protocol steps; only the TERMINAL ones are evidence. CLICK Prepare
 *    and Payme CreateTransaction are NON-terminal provider-binding operations and therefore get NO event id (§9/§11).
 *  - The stable FINANCIAL identity is the provider transaction id — Payme `params.id`, CLICK `click_trans_id`. Payme's
 *    JSON-RPC top-level request `id` is a transport correlation id ONLY and must never be used as idempotency authority.
 *  - Payme post-success cancellation (state -2) belongs to the FUTURE refund domain (§6/§7); no terminal event id is
 *    minted for it here.
 */

const PROVIDER_CLICK = 'CLICK';
const PROVIDER_PAYME = 'PAYME';

function requireId(kind: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`provider event id requires a non-empty ${kind}`);
  }
  return value;
}

/** Terminal SUCCESS evidence from a Payme PerformTransaction. */
export function paymePerformEventId(paymeTransactionId: string): string {
  return `${PROVIDER_PAYME}:${requireId('paymeTransactionId', paymeTransactionId)}:PERFORM`;
}

/** Terminal pre-success CANCEL evidence from a Payme CancelTransaction (state -1). */
export function paymeCancelEventId(paymeTransactionId: string): string {
  return `${PROVIDER_PAYME}:${requireId('paymeTransactionId', paymeTransactionId)}:CANCEL`;
}

/** Terminal evidence from a CLICK Complete (action=1). Prepare (action=0) is non-terminal and has no event id. */
export function clickCompleteEventId(clickTransId: string): string {
  return `${PROVIDER_CLICK}:${requireId('clickTransId', clickTransId)}:COMPLETE`;
}
