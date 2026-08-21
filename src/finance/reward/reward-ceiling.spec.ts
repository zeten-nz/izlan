import { rewardCeilingUzs, rewardCeilingIzl } from './reward-ceiling';

describe('reward ceiling arithmetic (Phase 2.1G-D §49/§50)', () => {
  describe('rewardCeilingUzs = floor(net × 20%)', () => {
    it('100000 → 20000', () => expect(rewardCeilingUzs(100000)).toBe(20000));
    it('96000 → 19200', () => expect(rewardCeilingUzs(96000)).toBe(19200));
    it('99999 → 19999 (floors 19999.8)', () => expect(rewardCeilingUzs(99999)).toBe(19999));
    it('0 → 0', () => expect(rewardCeilingUzs(0)).toBe(0));
  });

  describe('rewardCeilingIzl = floor(ceilingUzs / rate)', () => {
    it('19999 / 1000 → 19', () => expect(rewardCeilingIzl(19999, 1000)).toBe(19));
    it('19999 / 20000 → 0 (below one IZL)', () => expect(rewardCeilingIzl(19999, 20000)).toBe(0));
    it('20000 / 1000 → 20 (exact)', () => expect(rewardCeilingIzl(20000, 1000)).toBe(20));
    it('rate 0 → 0 (reward-disabled / invalid)', () => expect(rewardCeilingIzl(19999, 0)).toBe(0));
  });
});
