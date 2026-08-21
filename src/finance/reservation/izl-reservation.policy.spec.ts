import { canReserve } from './izl-reservation.policy';

describe('canReserve (TD-158, §67)', () => {
  it('§70/§76 fits within available', () => {
    expect(canReserve({ availableIzl: 10, requestedIzl: 4 })).toEqual({ ok: true });
  });
  it('§71 exactly available is allowed', () => {
    expect(canReserve({ availableIzl: 5, requestedIzl: 5 })).toEqual({ ok: true });
  });
  it('§72 over-reserve rejected', () => {
    expect(canReserve({ availableIzl: 5, requestedIzl: 6 })).toEqual({ ok: false, reason: 'insufficient_available' });
  });
  it('§68 zero available rejects any positive request', () => {
    expect(canReserve({ availableIzl: 0, requestedIzl: 1 })).toEqual({ ok: false, reason: 'insufficient_available' });
  });
  it('§7/§80 negative available never accepts a new hold', () => {
    expect(canReserve({ availableIzl: -2, requestedIzl: 1 })).toEqual({ ok: false, reason: 'insufficient_available' });
  });
  it('§21 non-positive / non-integer amount rejected', () => {
    expect(canReserve({ availableIzl: 10, requestedIzl: 0 })).toEqual({ ok: false, reason: 'non_positive_amount' });
    expect(canReserve({ availableIzl: 10, requestedIzl: -1 })).toEqual({ ok: false, reason: 'non_positive_amount' });
    expect(canReserve({ availableIzl: 10, requestedIzl: 1.5 })).toEqual({ ok: false, reason: 'non_positive_amount' });
  });
});
