import { evaluateRedemption, maxDiscountUzs } from './subscription-discount-redemption.policy';

describe('maxDiscountUzs (TD-173, §23)', () => {
  it('§42/§43 floor(gross × 2000 / 10000) integer-exact', () => {
    expect(maxDiscountUzs(100000)).toBe(20000);
    expect(maxDiscountUzs(99999)).toBe(19999); // floor(19999.8)
    expect(maxDiscountUzs(50000)).toBe(10000);
    expect(maxDiscountUzs(4)).toBe(0); // §25 tiny order → zero ceiling
  });
});

describe('evaluateRedemption (§24/§27)', () => {
  it('§42 within ceiling + available → ok with exact value', () => {
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 20, rateUzsPerIzl: 1000, availableIzl: 100 })).toEqual({ ok: true, valueUzs: 20000 });
  });
  it('§42 one over ceiling → exceeds_ceiling', () => {
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 21, rateUzsPerIzl: 1000, availableIzl: 100 })).toEqual({ ok: false, reason: 'exceeds_ceiling' });
  });
  it('§43 floor boundary: 19999 allowed, 20000 rejected (gross 99999, rate 1)', () => {
    expect(evaluateRedemption({ grossAmount: 99999, amountIzl: 19999, rateUzsPerIzl: 1, availableIzl: 99999 })).toEqual({ ok: true, valueUzs: 19999 });
    expect(evaluateRedemption({ grossAmount: 99999, amountIzl: 20000, rateUzsPerIzl: 1, availableIzl: 99999 })).toEqual({ ok: false, reason: 'exceeds_ceiling' });
  });
  it('§66/§67/§68 availability: over rejected, exact allowed, negative rejected', () => {
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 4, rateUzsPerIzl: 1, availableIzl: 3 })).toEqual({ ok: false, reason: 'insufficient_available' });
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 4, rateUzsPerIzl: 1, availableIzl: 4 })).toEqual({ ok: true, valueUzs: 4 });
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 1, rateUzsPerIzl: 1, availableIzl: -2 })).toEqual({ ok: false, reason: 'insufficient_available' });
  });
  it('§25 non-positive amount rejected', () => {
    expect(evaluateRedemption({ grossAmount: 100000, amountIzl: 0, rateUzsPerIzl: 1000, availableIzl: 100 })).toEqual({ ok: false, reason: 'non_positive_amount' });
  });
});
