import { computeIzlBalance } from './izl-balance.engine';

describe('computeIzlBalance (TD-157, §6)', () => {
  it('§69 available = balance - reserved', () => {
    expect(computeIzlBalance(10, 3)).toEqual({ balanceIzl: 10, reservedIzl: 3, availableIzl: 7 });
  });
  it('§68 zero state', () => {
    expect(computeIzlBalance(0, 0)).toEqual({ balanceIzl: 0, reservedIzl: 0, availableIzl: 0 });
  });
  it('§42 reserved > balance → negative available (never clamped)', () => {
    expect(computeIzlBalance(2, 3)).toEqual({ balanceIzl: 2, reservedIzl: 3, availableIzl: -1 });
  });
  it('§41 negative signed ledger balance is preserved', () => {
    expect(computeIzlBalance(-2, 0)).toEqual({ balanceIzl: -2, reservedIzl: 0, availableIzl: -2 });
  });
});
