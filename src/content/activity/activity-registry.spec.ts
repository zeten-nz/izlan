import { ActivityType } from '@prisma/client';
import {
  ACTIVITY_REGISTRY,
  getActivityDefinition,
  isObjectiveActivityType,
  isViewOnlyActivityType,
  isUnsupportedActivityType,
  OBJECTIVE_ACTIVITY_TYPES,
  VIEW_ONLY_ACTIVITY_TYPES,
  ActivityExecutionKind,
} from './activity-registry';

const allTypes = Object.values(ActivityType) as ActivityType[];
const kindOf = (k: ActivityExecutionKind) => allTypes.filter((t) => ACTIVITY_REGISTRY[t].executionKind === k).sort();

describe('canonical Activity registry (activity-registry-v1, TD-246)', () => {
  it('AR-01 every Prisma ActivityType is registered EXACTLY once (exhaustive, no extras)', () => {
    const keys = Object.keys(ACTIVITY_REGISTRY).sort();
    expect(keys).toEqual([...allTypes].sort()); // same members, and Object.keys is inherently unique → exactly once
    expect(keys).toHaveLength(allTypes.length);
    // each definition's self-declared type matches the key it is filed under
    for (const t of allTypes) expect(ACTIVITY_REGISTRY[t].type).toBe(t);
    // getActivityDefinition is total over the enum
    for (const t of allTypes) expect(getActivityDefinition(t)).toBe(ACTIVITY_REGISTRY[t]);
  });

  it('AR-02 objective classification is exactly MINI_QUESTION / PRACTICE / MASTERY_TEST', () => {
    expect(kindOf('OBJECTIVE')).toEqual([ActivityType.MASTERY_TEST, ActivityType.MINI_QUESTION, ActivityType.PRACTICE].sort());
    for (const t of [ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]) {
      expect(isObjectiveActivityType(t)).toBe(true);
      expect(OBJECTIVE_ACTIVITY_TYPES.has(t)).toBe(true);
    }
  });

  it('AR-03 view-only classification is exactly TEXT / EXPLANATION / IMAGE / AUDIO / EXAMPLE', () => {
    expect(kindOf('VIEW_ONLY')).toEqual(
      [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.IMAGE, ActivityType.AUDIO, ActivityType.EXAMPLE].sort(),
    );
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.IMAGE, ActivityType.AUDIO, ActivityType.EXAMPLE]) {
      expect(isViewOnlyActivityType(t)).toBe(true);
      expect(VIEW_ONLY_ACTIVITY_TYPES.has(t)).toBe(true);
    }
  });

  it('AR-04 deferred/unsupported classification is exactly SPEAKING / WRITING / LISTENING / AI_INTERACTION / VIDEO', () => {
    expect(kindOf('UNSUPPORTED')).toEqual(
      [ActivityType.SPEAKING, ActivityType.WRITING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO].sort(),
    );
    // VIDEO is deferred, NOT view-only, even though it "sounds" view-only (current runtime, §4)
    expect(isUnsupportedActivityType(ActivityType.VIDEO)).toBe(true);
    expect(isViewOnlyActivityType(ActivityType.VIDEO)).toBe(false);
  });

  it('AR-05 completion evidence maps correctly per execution kind', () => {
    for (const t of allTypes) {
      const d = ACTIVITY_REGISTRY[t];
      const expected =
        d.executionKind === 'OBJECTIVE' ? 'SUBMITTED_ATTEMPT' : d.executionKind === 'VIEW_ONLY' ? 'COMPLETED_ACTIVITY' : 'UNSUPPORTED';
      expect(d.completionEvidence).toBe(expected);
    }
  });

  it('AR-06 scoring capability: objective → deterministic, everything else → none', () => {
    for (const t of allTypes) {
      const d = ACTIVITY_REGISTRY[t];
      expect(d.scoring).toBe(d.executionKind === 'OBJECTIVE' ? 'DETERMINISTIC_OBJECTIVE' : 'NONE');
    }
  });

  it('AR-07 learner projection + payload contract follow execution kind (objective safe / metadata-only; no invented view-only contract)', () => {
    for (const t of allTypes) {
      const d = ACTIVITY_REGISTRY[t];
      if (d.executionKind === 'OBJECTIVE') expect(d.learnerProjection).toBe('OBJECTIVE_SAFE');
      else if (d.payloadContract === 'LESSON_MARKDOWN_V1') expect(d.learnerProjection).toBe('MARKDOWN_SAFE');
      else expect(d.learnerProjection).toBe('METADATA_ONLY');
    }
  });

  it('AR-09 learner projection mapping (2.2B): objective→OBJECTIVE_SAFE, prose→MARKDOWN_SAFE, media/deferred→METADATA_ONLY', () => {
    const projOf = (t: ActivityType) => ACTIVITY_REGISTRY[t].learnerProjection;
    for (const t of [ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]) expect(projOf(t)).toBe('OBJECTIVE_SAFE');
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]) expect(projOf(t)).toBe('MARKDOWN_SAFE');
    for (const t of [ActivityType.IMAGE, ActivityType.AUDIO, ActivityType.SPEAKING, ActivityType.WRITING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO]) expect(projOf(t)).toBe('METADATA_ONLY');
  });

  it('AR-08 payloadContract mapping (2.2A-2): objective→OBJECTIVE_V1, prose→MARKDOWN_V1, media→MEDIA_V1, deferred→NONE_DEFINED', () => {
    const contractOf = (t: ActivityType) => ACTIVITY_REGISTRY[t].payloadContract;
    for (const t of [ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]) expect(contractOf(t)).toBe('LESSON_OBJECTIVE_V1');
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]) expect(contractOf(t)).toBe('LESSON_MARKDOWN_V1');
    for (const t of [ActivityType.IMAGE, ActivityType.AUDIO]) expect(contractOf(t)).toBe('LESSON_MEDIA_V1');
    for (const t of [ActivityType.SPEAKING, ActivityType.WRITING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO]) expect(contractOf(t)).toBe('NONE_DEFINED');
  });

  it('the three predicates partition the enum (each type is exactly one kind)', () => {
    for (const t of allTypes) {
      const flags = [isObjectiveActivityType(t), isViewOnlyActivityType(t), isUnsupportedActivityType(t)];
      expect(flags.filter(Boolean)).toHaveLength(1);
    }
  });
});
