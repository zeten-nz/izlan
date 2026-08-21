import { evaluateDailyMissionXp, DAILY_MISSION_XP_REWARD_VERSION, DAILY_MISSION_XP_REASON_CODE } from './daily-mission-xp.policy';

describe('evaluateDailyMissionXp (daily-mission-xp-reward-v1)', () => {
  it('§15/§47 LEARN_TODAY + learn-today-mission-v1 → 10 XP', () => {
    expect(evaluateDailyMissionXp({ missionCode: 'LEARN_TODAY', missionPolicyVersion: 'learn-today-mission-v1' })).toEqual({
      eligible: true,
      amount: 10,
      reasonCode: DAILY_MISSION_XP_REASON_CODE,
      policyVersionCode: DAILY_MISSION_XP_REWARD_VERSION,
    });
  });

  it('§15/§48 MASTERY_TEST_90 + mastery-test-90-mission-v1 → 20 XP', () => {
    expect(evaluateDailyMissionXp({ missionCode: 'MASTERY_TEST_90', missionPolicyVersion: 'mastery-test-90-mission-v1' })).toMatchObject({ eligible: true, amount: 20 });
  });

  it('§16/§54 known code + unknown producer version → not eligible (no default)', () => {
    expect(evaluateDailyMissionXp({ missionCode: 'LEARN_TODAY', missionPolicyVersion: 'learn-today-mission-v2' })).toEqual({ eligible: false });
    expect(evaluateDailyMissionXp({ missionCode: 'MASTERY_TEST_90', missionPolicyVersion: 'mastery-test-90-mission-v2' })).toEqual({ eligible: false });
  });

  it('§53 unknown mission code → not eligible', () => {
    expect(evaluateDailyMissionXp({ missionCode: 'ATTENTION_CHECK', missionPolicyVersion: 'learn-today-mission-v1' })).toEqual({ eligible: false });
  });

  it('cross-paired code+version does not qualify (exact pair required)', () => {
    expect(evaluateDailyMissionXp({ missionCode: 'LEARN_TODAY', missionPolicyVersion: 'mastery-test-90-mission-v1' })).toEqual({ eligible: false });
    expect(evaluateDailyMissionXp({ missionCode: 'MASTERY_TEST_90', missionPolicyVersion: 'learn-today-mission-v1' })).toEqual({ eligible: false });
  });
});
