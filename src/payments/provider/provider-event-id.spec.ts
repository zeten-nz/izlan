import { clickCompleteEventId, paymeCancelEventId, paymePerformEventId } from './provider-event-id';

describe('provider terminal-callback event ids (Phase 2.1L-D §9/§15)', () => {
  it('formats Payme PERFORM/CANCEL and CLICK COMPLETE deterministically from the financial id', () => {
    expect(paymePerformEventId('5305e3bab097f420a62ced0b')).toBe('PAYME:5305e3bab097f420a62ced0b:PERFORM');
    expect(paymeCancelEventId('5305e3bab097f420a62ced0b')).toBe('PAYME:5305e3bab097f420a62ced0b:CANCEL');
    expect(clickCompleteEventId('987654321')).toBe('CLICK:987654321:COMPLETE');
  });

  it('is stable across calls — the dedup / idempotency authority (§9)', () => {
    expect(paymePerformEventId('x')).toBe(paymePerformEventId('x'));
    expect(paymeCancelEventId('x')).toBe(paymeCancelEventId('x'));
    expect(clickCompleteEventId('x')).toBe(clickCompleteEventId('x'));
  });

  it('perform and cancel of the same Payme id never collide', () => {
    expect(paymePerformEventId('abc')).not.toBe(paymeCancelEventId('abc'));
  });

  it('rejects an empty/blank financial id — never a silent empty event id', () => {
    for (const f of [paymePerformEventId, paymeCancelEventId, clickCompleteEventId]) {
      expect(() => f('')).toThrow();
      expect(() => f('   ')).toThrow();
    }
  });
});
