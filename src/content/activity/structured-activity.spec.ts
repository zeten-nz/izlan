import { ActivityInvalidResponseError, ActivityPayloadInvalidError } from '../../common/errors';
import { parseStructuredActivityPayload, projectStructuredForLearner } from './structured-activity-payload';
import { scoreStructured, canonicalizeStructured } from './structured-activity-scorer';
import { parseInteractiveActivity, scoreInteractive, interactiveEvidence, projectInteractiveForLearner } from './activity-interaction';

const V = 'lesson-activity-structured/v1';

const sentenceOrder = () => ({ schemaVersion: V, format: 'sentence_order', prompt: 'Order the words.', tokens: [{ id: 't1', text: 'I' }, { id: 't2', text: 'work' }, { id: 't3', text: 'here' }], answerKey: { correctOrder: ['t1', 't2', 't3'] }, remediation: 'Subject → verb → place.' });
const fillBlank = () => ({ schemaVersion: V, format: 'fill_blank', prompt: 'Fill the blank.', segments: [{ text: 'I have ' }, { blankId: 'b1' }, { text: ' apple.' }], blanks: { b1: { accepted: ['an'] } }, normalization: { caseFold: true } });
const controlledText = () => ({ schemaVersion: V, format: 'controlled_text', prompt: 'Type the plural of "box".', answerKey: { accepted: ['boxes'] }, normalization: { caseFold: true } });

describe('structured activity payloads (lesson-activity-structured/v1)', () => {
  describe('validation', () => {
    it('SP-01 accepts a valid sentence_order / fill_blank / controlled_text', () => {
      expect(parseStructuredActivityPayload(sentenceOrder()).format).toBe('sentence_order');
      expect(parseStructuredActivityPayload(fillBlank()).format).toBe('fill_blank');
      expect(parseStructuredActivityPayload(controlledText()).format).toBe('controlled_text');
    });

    it('SP-02 rejects malformed payloads (bad order, unknown blank, empty accepted, extra keys)', () => {
      const bad = [
        { ...sentenceOrder(), answerKey: { correctOrder: ['t1', 't2'] } }, // wrong length
        { ...sentenceOrder(), answerKey: { correctOrder: ['t1', 't2', 't9'] } }, // unknown id
        { ...fillBlank(), blanks: { bX: { accepted: ['an'] } } }, // blank id not in segments
        { ...fillBlank(), blanks: { b1: { accepted: [] } } }, // empty accepted set
        { ...controlledText(), answerKey: { accepted: [] } },
        { ...controlledText(), normalization: { fuzzy: true } }, // unknown normalization key
        { schemaVersion: V, format: 'nonsense', prompt: 'x' },
      ];
      for (const p of bad) expect(() => parseStructuredActivityPayload(p)).toThrow(ActivityPayloadInvalidError);
    });
  });

  describe('scoring (deterministic, exact-match after explicit normalization)', () => {
    it('SP-03 sentence_order: correct only for the exact canonical order', () => {
      const p = parseStructuredActivityPayload(sentenceOrder());
      expect(scoreStructured(p, { orderedTokenIds: ['t1', 't2', 't3'] })).toMatchObject({ isCorrect: true, deterministicScore: 10000 });
      expect(scoreStructured(p, { orderedTokenIds: ['t2', 't1', 't3'] })).toMatchObject({ isCorrect: false, deterministicScore: 0 });
    });

    it('SP-04 fill_blank: per-blank exact match; wrong blank → incorrect + safe incorrectBlankIds (no values)', () => {
      const p = parseStructuredActivityPayload(fillBlank());
      expect(scoreStructured(p, { blanks: { b1: 'an' } })).toMatchObject({ isCorrect: true });
      const wrong = scoreStructured(p, { blanks: { b1: 'a' } });
      expect(wrong.isCorrect).toBe(false);
      expect(wrong.feedback.incorrectBlankIds).toEqual(['b1']); // ids only — the accepted value ('an') is never in the feedback
      expect(wrong.feedback).not.toHaveProperty('accepted');
      expect(wrong.feedback).not.toHaveProperty('expected');
    });

    it('SP-05 controlled_text: case-folds (irrelevant) but does NOT accept materially wrong grammar', () => {
      const p = parseStructuredActivityPayload(controlledText());
      expect(scoreStructured(p, { text: 'Boxes' }).isCorrect).toBe(true); // case irrelevant → accepted
      expect(scoreStructured(p, { text: '  boxes ' }).isCorrect).toBe(true); // trimmed/collapsed
      expect(scoreStructured(p, { text: 'boxs' }).isCorrect).toBe(false); // wrong plural → rejected, never fuzzily accepted
      expect(scoreStructured(p, { text: 'box' }).isCorrect).toBe(false);
    });

    it('SP-06 malformed answers are rejected safely (never scored)', () => {
      const so = parseStructuredActivityPayload(sentenceOrder());
      expect(() => scoreStructured(so, { orderedTokenIds: ['t1', 't1', 't2'] })).toThrow(ActivityInvalidResponseError); // duplicate
      expect(() => scoreStructured(so, { selectedOptionId: 't1' })).toThrow(ActivityInvalidResponseError); // wrong field
      const fb = parseStructuredActivityPayload(fillBlank());
      expect(() => scoreStructured(fb, { blanks: { b1: 5 } })).toThrow(ActivityInvalidResponseError); // non-string
      expect(() => scoreStructured(fb, { blanks: {} })).toThrow(ActivityInvalidResponseError); // missing blank
      const ct = parseStructuredActivityPayload(controlledText());
      expect(() => scoreStructured(ct, { text: 123 })).toThrow(ActivityInvalidResponseError);
    });

    it('SP-07 canonicalize is stable for idempotent-retry (normalized)', () => {
      const ct = parseStructuredActivityPayload(controlledText());
      expect(canonicalizeStructured(ct, { text: 'Boxes' })).toBe(canonicalizeStructured(ct, { text: ' boxes ' }));
      expect(canonicalizeStructured(ct, { text: 'boxes' })).not.toBe(canonicalizeStructured(ct, { text: 'boxs' }));
    });
  });

  describe('learner projection (answer-key-free)', () => {
    it('SP-08 strips accepted sets / correct order / remediation for every format', () => {
      for (const raw of [sentenceOrder(), fillBlank(), controlledText()]) {
        const p = parseStructuredActivityPayload(raw);
        const projected = projectStructuredForLearner('a1', 'PRACTICE', 3, p);
        const json = JSON.stringify(projected);
        expect(json).not.toMatch(/answerKey|correctOrder|accepted|remediation/);
      }
    });

    it('SP-09 fill_blank projection exposes the blank ids + segments but no accepted values', () => {
      const p = parseStructuredActivityPayload(fillBlank());
      const projected = projectStructuredForLearner('a1', 'PRACTICE', 3, p) as { blankIds: string[] };
      expect(projected.blankIds).toEqual(['b1']);
      expect(JSON.stringify(projected)).not.toContain('"an"');
    });
  });

  describe('interaction dispatcher + honest evidence', () => {
    it('SP-10 structured → controlled-production@2; choice → recognition@1', () => {
      const structured = parseInteractiveActivity(sentenceOrder());
      expect(interactiveEvidence(structured)).toEqual({ evidenceKind: 'controlled-production', independenceLevel: 2 });
      const choice = parseInteractiveActivity({ schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt: 'q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
      expect(interactiveEvidence(choice)).toEqual({ evidenceKind: 'recognition', independenceLevel: 1 });
    });

    it('SP-11 dispatcher routes score + projection for both families; never leaks answer keys', () => {
      const structured = parseInteractiveActivity(fillBlank());
      expect(scoreInteractive(structured, { blanks: { b1: 'an' } }).isCorrect).toBe(true);
      expect(JSON.stringify(projectInteractiveForLearner('a', 'PRACTICE', 0, structured))).not.toMatch(/accepted|answerKey/);
    });
  });
});
