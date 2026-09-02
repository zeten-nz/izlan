import {
  LESSON_ACTIVITY_READING_SCHEMA_VERSION,
  isReadingSchema,
  parseReadingActivityPayload,
  projectReadingForLearner,
} from './reading-activity-payload';
import { parseInteractiveActivity, scoreInteractive, canonicalizeInteractive, interactiveEvidence, interactionKindOf, projectInteractiveForLearner } from './activity-interaction';
import { ActivityPayloadInvalidError } from '../../common/errors';

/** A valid reading comprehension payload: a learner-visible passage + a single_choice comprehension question. */
const validReading = () => ({
  schemaVersion: LESSON_ACTIVITY_READING_SCHEMA_VERSION,
  format: 'reading_comprehension',
  passage: 'My name is Aziz. I am a doctor. I work in a hospital in Tashkent.',
  prompt: 'What is Aziz’s job?',
  options: [
    { id: 'o1', text: 'A teacher' },
    { id: 'o2', text: 'A doctor' },
    { id: 'o3', text: 'A driver' },
  ],
  answerKey: { correctOptionIds: ['o2'] },
});

describe('lesson-activity-reading/v1 (RD-01..RD-09)', () => {
  it('RD-01 validates a well-formed reading comprehension payload', () => {
    const p = parseReadingActivityPayload(validReading());
    expect(p.schemaVersion).toBe(LESSON_ACTIVITY_READING_SCHEMA_VERSION);
    expect(p.format).toBe('reading_comprehension');
    expect(p.passage).toContain('I am a doctor');
    expect(p.answerKey.correctOptionIds).toEqual(['o2']);
    expect(isReadingSchema(validReading())).toBe(true);
  });

  it('RD-02 rejects malformed payloads (empty/oversized passage, bad format, no correct option)', () => {
    expect(() => parseReadingActivityPayload({ ...validReading(), passage: '' })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload({ ...validReading(), passage: '   ' })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload({ ...validReading(), passage: 'x'.repeat(1201) })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload({ ...validReading(), format: 'single_choice' })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload({ ...validReading(), answerKey: { correctOptionIds: [] } })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload({ ...validReading(), answerKey: { correctOptionIds: ['nope'] } })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseReadingActivityPayload(null)).toThrow(ActivityPayloadInvalidError);
  });

  it('RD-03 learner projection KEEPS the passage (it is the stimulus) but STRIPS the answerKey', () => {
    const view = projectReadingForLearner('a1', 'MINI_QUESTION', 0, parseReadingActivityPayload(validReading()));
    expect(view).not.toHaveProperty('answerKey');
    expect(view.passage).toContain('I am a doctor'); // learner must read it
    expect(view.prompt).toContain('job');
    expect(view.options).toEqual([
      { id: 'o1', text: 'A teacher' },
      { id: 'o2', text: 'A doctor' },
      { id: 'o3', text: 'A driver' },
    ]);
    expect(JSON.stringify(view)).not.toContain('correctOptionIds');
  });

  it('RD-04 flows through the shared interaction engine as a READING activity', () => {
    const act = parseInteractiveActivity(validReading());
    expect(act.kind).toBe('READING');
    expect(interactionKindOf(validReading())).toBe('READING');
  });

  it('RD-05 is scored deterministically like a single_choice question', () => {
    const act = parseInteractiveActivity(validReading());
    expect(scoreInteractive(act, { selectedOptionId: 'o2' })).toMatchObject({ isCorrect: true, deterministicScore: 10000 });
    expect(scoreInteractive(act, { selectedOptionId: 'o1' })).toMatchObject({ isCorrect: false, deterministicScore: 0 });
  });

  it('RD-06 malformed learner answers are rejected without leaking the key', () => {
    const act = parseInteractiveActivity(validReading());
    expect(() => scoreInteractive(act, { selectedOptionId: 123 })).toThrow();
    expect(() => scoreInteractive(act, {})).toThrow();
    try {
      scoreInteractive(act, { selectedOptionId: 'not-an-option' });
      throw new Error('expected throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('o2');
    }
  });

  it('RD-07 canonicalization is stable for idempotent replay', () => {
    const act = parseInteractiveActivity(validReading());
    expect(canonicalizeInteractive(act, { selectedOptionId: 'o2' })).toBe(canonicalizeInteractive(act, { selectedOptionId: 'o2' }));
  });

  it('RD-08 emits honest reading-comprehension@1 evidence — DISTINCT from grammar recognition', () => {
    const act = parseInteractiveActivity(validReading());
    expect(interactiveEvidence(act)).toEqual({ evidenceKind: 'reading-comprehension', independenceLevel: 1 });
    // A plain single_choice grammar question is recognition — reading must never be confused with it.
    const choice = parseInteractiveActivity({ schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt: 'x?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
    expect(interactiveEvidence(choice).evidenceKind).toBe('recognition');
    expect(interactiveEvidence(act).evidenceKind).not.toBe(interactiveEvidence(choice).evidenceKind);
  });

  it('RD-09 the shared projector also keeps the passage and strips the key', () => {
    const view = projectInteractiveForLearner('a1', 'MINI_QUESTION', 0, parseInteractiveActivity(validReading())) as { passage?: string };
    expect(view).not.toHaveProperty('answerKey');
    expect(view.passage).toContain('Tashkent');
  });
});
