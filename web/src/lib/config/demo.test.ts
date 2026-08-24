import { describe, it, expect } from 'vitest';
import { DEMO_ACCOUNTS, DEMO_LEARNER_ACCOUNTS } from './demo';

/** Keeps staff-demo vs learner-demo separation explicit: the learner flow is tested with +998900000003 only. */
describe('Demo accounts (WEB-DEMO)', () => {
  it('WEB-DEMO-01 learner demo helper offers only the LEARNER account (+998900000003)', () => {
    expect(DEMO_LEARNER_ACCOUNTS.map((a) => a.phone)).toEqual(['+998900000003']);
  });

  it('WEB-DEMO-02 staff demo helper offers the ADMIN and METHODIST accounts, not the learner', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.phone)).toEqual(['+998900000001', '+998900000002']);
    expect(DEMO_ACCOUNTS.map((a) => a.phone)).not.toContain('+998900000003');
  });
});
