import { describe, it, expect } from 'vitest';
import { isCanonicalMarkdownPayload, serializeMarkdownPayload } from './markdown-serializer';
import { isCanonicalObjectivePayload, objectiveDraftError, serializeObjectivePayload, type ObjectiveDraft } from './objective-serializer';

describe('WEB-09 markdown serializer → canonical lesson-activity-markdown/v1', () => {
  it('produces exactly { schemaVersion, markdown } and trims', () => {
    const p = serializeMarkdownPayload('  # Hi  ');
    expect(p).toEqual({ schemaVersion: 'lesson-activity-markdown/v1', markdown: '# Hi' });
    expect(isCanonicalMarkdownPayload(p)).toBe(true);
  });
  it('rejects empty and extra-key payloads', () => {
    expect(isCanonicalMarkdownPayload(serializeMarkdownPayload('   '))).toBe(false);
    expect(isCanonicalMarkdownPayload({ schemaVersion: 'lesson-activity-markdown/v1', markdown: 'a', rawHtml: '<b>' })).toBe(false);
    expect(isCanonicalMarkdownPayload({ schemaVersion: 'x', markdown: 'a' })).toBe(false);
  });
});

describe('WEB-10 objective serializer → canonical lesson-activity-objective/v1', () => {
  const single: ObjectiveDraft = {
    format: 'single_choice',
    prompt: 'Q?',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: ['a'],
  };
  const multi: ObjectiveDraft = {
    format: 'multiple_choice',
    prompt: 'Q?',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    correctOptionIds: ['a', 'c'],
  };
  const tf: ObjectiveDraft = {
    format: 'true_false',
    prompt: 'Q?',
    options: [
      { id: 't', text: 'To‘g‘ri' },
      { id: 'f', text: 'Noto‘g‘ri' },
    ],
    correctOptionIds: ['t'],
  };

  it('every format serializes to a payload the backend contract accepts', () => {
    for (const d of [single, multi, tf]) {
      const p = serializeObjectivePayload(d);
      expect(p.schemaVersion).toBe('lesson-activity-objective/v1');
      expect(p.answerKey.correctOptionIds.length).toBeGreaterThan(0);
      expect(isCanonicalObjectivePayload(p)).toBe(true);
      expect(objectiveDraftError(d)).toBeNull();
    }
  });

  it('single_choice / true_false require exactly one correct', () => {
    const bad = { ...single, correctOptionIds: ['a', 'b'] };
    expect(objectiveDraftError(bad)).not.toBeNull();
    expect(isCanonicalObjectivePayload(serializeObjectivePayload(bad))).toBe(false);
  });

  it('rejects fewer than two options and unknown correct ids', () => {
    expect(objectiveDraftError({ ...single, options: [{ id: 'a', text: 'A' }] })).not.toBeNull();
    const strayCorrect = serializeObjectivePayload({ ...single, correctOptionIds: ['zzz'] });
    expect(isCanonicalObjectivePayload(strayCorrect)).toBe(false); // serializer drops the stray → empty correct → invalid
  });
});
