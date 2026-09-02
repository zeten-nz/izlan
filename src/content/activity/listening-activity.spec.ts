import {
  LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION,
  isListeningSchema,
  parseListeningActivityPayload,
  projectListeningForLearner,
} from './listening-activity-payload';
import { parseInteractiveActivity, scoreInteractive, canonicalizeInteractive, interactiveEvidence, interactionKindOf, projectInteractiveForLearner } from './activity-interaction';
import { ActivityPayloadInvalidError } from '../../common/errors';

/** A valid listening comprehension payload (single_choice body + server-only answerKey/transcript). */
const validListening = () => ({
  schemaVersion: LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION,
  format: 'listening_comprehension',
  prompt: 'What does the speaker order?',
  options: [
    { id: 'o1', text: 'A coffee' },
    { id: 'o2', text: 'A tea' },
    { id: 'o3', text: 'A water' },
  ],
  answerKey: { correctOptionIds: ['o1'] },
  transcript: "Hi, can I have a coffee please?",
});

describe('lesson-activity-listening/v1 (LI-01..LI-08)', () => {
  it('LI-01 validates a well-formed listening comprehension payload', () => {
    const p = parseListeningActivityPayload(validListening());
    expect(p.schemaVersion).toBe(LESSON_ACTIVITY_LISTENING_SCHEMA_VERSION);
    expect(p.format).toBe('listening_comprehension');
    expect(p.options).toHaveLength(3);
    expect(p.answerKey.correctOptionIds).toEqual(['o1']);
    expect(isListeningSchema(validListening())).toBe(true);
  });

  it('LI-02 rejects malformed payloads (bad format, no correct option, empty transcript)', () => {
    expect(() => parseListeningActivityPayload({ ...validListening(), format: 'single_choice' })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseListeningActivityPayload({ ...validListening(), answerKey: { correctOptionIds: [] } })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseListeningActivityPayload({ ...validListening(), answerKey: { correctOptionIds: ['nope'] } })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseListeningActivityPayload({ ...validListening(), transcript: '' })).toThrow(ActivityPayloadInvalidError);
    expect(() => parseListeningActivityPayload(null)).toThrow(ActivityPayloadInvalidError);
  });

  it('LI-03 learner projection strips answerKey AND transcript (no audio leak either)', () => {
    const view = projectListeningForLearner('a1', 'MINI_QUESTION', 0, parseListeningActivityPayload(validListening()));
    expect(view).not.toHaveProperty('answerKey');
    expect(view).not.toHaveProperty('transcript');
    expect(view.prompt).toBe('What does the speaker order?');
    expect(view.options).toEqual([
      { id: 'o1', text: 'A coffee' },
      { id: 'o2', text: 'A tea' },
      { id: 'o3', text: 'A water' },
    ]);
    // No storage keys / URLs — audio is attached relationally and fetched by MediaAsset id, not embedded here.
    expect(JSON.stringify(view)).not.toContain('coffee please');
  });

  it('LI-04 flows through the shared interaction engine as a LISTENING activity', () => {
    const act = parseInteractiveActivity(validListening());
    expect(act.kind).toBe('LISTENING');
    expect(interactionKindOf(validListening())).toBe('LISTENING');
  });

  it('LI-05 is scored deterministically like a single_choice question', () => {
    const act = parseInteractiveActivity(validListening());
    expect(scoreInteractive(act, { selectedOptionId: 'o1' })).toMatchObject({ isCorrect: true, deterministicScore: 10000 });
    expect(scoreInteractive(act, { selectedOptionId: 'o2' })).toMatchObject({ isCorrect: false, deterministicScore: 0 });
  });

  it('LI-06 malformed learner answers are rejected without leaking the key', () => {
    const act = parseInteractiveActivity(validListening());
    expect(() => scoreInteractive(act, { selectedOptionId: 123 })).toThrow();
    expect(() => scoreInteractive(act, {})).toThrow();
    try {
      scoreInteractive(act, { selectedOptionId: 'not-an-option' });
      throw new Error('expected throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('o1');
    }
  });

  it('LI-07 canonicalization is stable for idempotent replay', () => {
    const act = parseInteractiveActivity(validListening());
    const c1 = canonicalizeInteractive(act, { selectedOptionId: 'o1' });
    const c2 = canonicalizeInteractive(act, { selectedOptionId: 'o1' });
    expect(c1).toBe(c2);
  });

  it('LI-08 emits honest listening-comprehension@1 evidence (never speaking/pronunciation)', () => {
    const act = parseInteractiveActivity(validListening());
    expect(interactiveEvidence(act)).toEqual({ evidenceKind: 'listening-comprehension', independenceLevel: 1 });
    // Shared projector also strips the key.
    const view = projectInteractiveForLearner('a1', 'MINI_QUESTION', 0, act);
    expect(view).not.toHaveProperty('answerKey');
  });
});
