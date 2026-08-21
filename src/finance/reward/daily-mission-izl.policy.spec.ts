import { evaluateDailyMissionIzl, parseIzlRewardPolicyConfig, IzlRewardConfigError } from './daily-mission-izl.policy';

const VALID = {
  schemaVersion: 'izl-reward-policy/v1',
  dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'mastery-test-90-mission-v1', amountIzl: 1 } },
  caps: { dailyMissionIzlPerLocalDate: 1, dailyMissionIzlPerCycle: 30 },
};

describe('parseIzlRewardPolicyConfig (izl-reward-policy/v1, §8 strict)', () => {
  it('parses a valid economic config', () => {
    expect(parseIzlRewardPolicyConfig(VALID)).toMatchObject({ schemaVersion: 'izl-reward-policy/v1', caps: { dailyMissionIzlPerLocalDate: 1, dailyMissionIzlPerCycle: 30 } });
  });
  it('rejects unknown schemaVersion / missing sections / bad caps / bad amount', () => {
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, schemaVersion: 'izl-reward-policy/v2' })).toThrow(IzlRewardConfigError);
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, caps: undefined })).toThrow(IzlRewardConfigError);
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, caps: { dailyMissionIzlPerLocalDate: -1, dailyMissionIzlPerCycle: 30 } })).toThrow(IzlRewardConfigError);
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'x', amountIzl: 0 } } })).toThrow(IzlRewardConfigError);
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'x', amountIzl: 1.5 } } })).toThrow(IzlRewardConfigError);
    expect(() => parseIzlRewardPolicyConfig(null)).toThrow(IzlRewardConfigError);
  });
  it('rejects a reward amount that exceeds the daily cap', () => {
    expect(() => parseIzlRewardPolicyConfig({ ...VALID, dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'mastery-test-90-mission-v1', amountIzl: 5 } } })).toThrow(IzlRewardConfigError);
  });
});

describe('evaluateDailyMissionIzl (§4/§59/§60)', () => {
  const policy = parseIzlRewardPolicyConfig(VALID);
  it('MASTERY_TEST_90 + mastery-test-90-mission-v1 → 1 IZL + caps', () => {
    expect(evaluateDailyMissionIzl('MASTERY_TEST_90', 'mastery-test-90-mission-v1', policy)).toEqual({ eligible: true, amountIzl: 1, dailyCapIzl: 1, cycleCapIzl: 30 });
  });
  it('LEARN_TODAY → not eligible (0 IZL, absent from policy)', () => {
    expect(evaluateDailyMissionIzl('LEARN_TODAY', 'learn-today-mission-v1', policy)).toEqual({ eligible: false });
  });
  it('unknown producer version → not eligible (no default)', () => {
    expect(evaluateDailyMissionIzl('MASTERY_TEST_90', 'mastery-test-90-mission-v2', policy)).toEqual({ eligible: false });
  });
});
