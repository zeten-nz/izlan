import { assertInvestorDemoAllowed, type InvestorDemoEnv } from './prepare-investor-demo';

const OK: InvestorDemoEnv = {
  nodeEnv: 'development',
  allowInvestorDemo: 'true',
  allowDemoSeed: 'true',
  allowDevFixture: 'true',
  adminPassword: 'DemoAdmin!123',
  methodistPassword: 'DemoMethodist!123',
  learnerPassword: 'DemoLearner!123',
};

describe('investor demo prep guard (Slice 1)', () => {
  it('INV-PREP-01 allows only with ALL THREE opt-ins + non-production + all env passwords', () => {
    expect(() => assertInvestorDemoAllowed(OK)).not.toThrow();
  });

  it('INV-PREP-02 fails CLOSED without ALLOW_INVESTOR_DEMO', () => {
    expect(() => assertInvestorDemoAllowed({ ...OK, allowInvestorDemo: undefined })).toThrow(/ALLOW_INVESTOR_DEMO/);
    expect(() => assertInvestorDemoAllowed({ ...OK, allowInvestorDemo: 'false' })).toThrow(/ALLOW_INVESTOR_DEMO/);
    expect(() => assertInvestorDemoAllowed({ ...OK, allowInvestorDemo: '' })).toThrow(/ALLOW_INVESTOR_DEMO/);
  });

  it('INV-PREP-02b does NOT bypass the composed sub-seed guards — requires ALLOW_DEMO_SEED and ALLOW_DEV_FIXTURE too', () => {
    expect(() => assertInvestorDemoAllowed({ ...OK, allowDemoSeed: undefined })).toThrow(/ALLOW_DEMO_SEED/);
    expect(() => assertInvestorDemoAllowed({ ...OK, allowDevFixture: undefined })).toThrow(/ALLOW_DEV_FIXTURE/);
  });

  it('INV-PREP-03 fails CLOSED in production even WITH every flag', () => {
    expect(() => assertInvestorDemoAllowed({ ...OK, nodeEnv: 'production' })).toThrow(/forbidden in production/);
  });

  it('INV-PREP-04 requires the env-owned demo passwords (none are embedded in code)', () => {
    expect(() => assertInvestorDemoAllowed({ ...OK, adminPassword: undefined })).toThrow(/PASSWORD/);
    expect(() => assertInvestorDemoAllowed({ ...OK, methodistPassword: undefined })).toThrow(/PASSWORD/);
    expect(() => assertInvestorDemoAllowed({ ...OK, learnerPassword: '' })).toThrow(/PASSWORD/);
  });
});
