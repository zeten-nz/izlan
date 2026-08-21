import { ActivityAttemptStatus, ActivityType } from '@prisma/client';
import { MissionEvidence, qualifiesLearnToday, qualifiesMasteryTest90 } from './daily-mission.policy';

const ev = (activityType: ActivityType, deterministicScoreBp: number | null, o: Partial<MissionEvidence> = {}): MissionEvidence => ({
  attemptId: o.attemptId ?? 'att',
  activityType,
  status: o.status ?? ActivityAttemptStatus.SUBMITTED,
  deterministicScoreBp,
  submittedAt: o.submittedAt ?? new Date('2026-08-20T10:00:00Z'),
  reviewSessionId: o.reviewSessionId ?? null,
});

describe('qualifiesLearnToday (learn-today-mission-v1)', () => {
  it('§6/§50 any SUBMITTED objective attempt qualifies — correctness irrelevant', () => {
    expect(qualifiesLearnToday(ev(ActivityType.PRACTICE, 0))).toBe(true); // wrong still counts
    expect(qualifiesLearnToday(ev(ActivityType.MINI_QUESTION, 10000))).toBe(true);
    expect(qualifiesLearnToday(ev(ActivityType.MASTERY_TEST, 5000))).toBe(true);
  });

  it('§9 review attempt (reviewSessionId set) also qualifies', () => {
    expect(qualifiesLearnToday(ev(ActivityType.PRACTICE, 0, { reviewSessionId: 'sess' }))).toBe(true);
  });

  it('§7/§55 non-objective types do not qualify', () => {
    for (const t of [ActivityType.TEXT, ActivityType.LISTENING, ActivityType.WRITING, ActivityType.VIDEO]) expect(qualifiesLearnToday(ev(t, 0))).toBe(false);
  });

  it('non-SUBMITTED does not qualify', () => {
    expect(qualifiesLearnToday(ev(ActivityType.PRACTICE, 0, { status: ActivityAttemptStatus.IN_PROGRESS }))).toBe(false);
  });
});

describe('qualifiesMasteryTest90 (mastery-test-90-mission-v1)', () => {
  it('§15/§56 threshold: 8999 no, 9000 yes, 10000 yes', () => {
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, 8999))).toBe(false);
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, 9000))).toBe(true);
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, 10000))).toBe(true);
  });

  it('§12 only MASTERY_TEST type qualifies (a high PRACTICE score does not)', () => {
    expect(qualifiesMasteryTest90(ev(ActivityType.PRACTICE, 10000))).toBe(false);
    expect(qualifiesMasteryTest90(ev(ActivityType.MINI_QUESTION, 10000))).toBe(false);
  });

  it('§13 a review MASTERY_TEST >= 9000 qualifies', () => {
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, 10000, { reviewSessionId: 'sess' }))).toBe(true);
  });

  it('null score / non-SUBMITTED does not qualify', () => {
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, null))).toBe(false);
    expect(qualifiesMasteryTest90(ev(ActivityType.MASTERY_TEST, 10000, { status: ActivityAttemptStatus.IN_PROGRESS }))).toBe(false);
  });
});
