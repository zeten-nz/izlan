import { ActivityType } from '@prisma/client';
import { ContentActivityPayloadInvalidError, ContentActivityTypeNotAuthorableError } from '../../common/errors';
import { validateActivityPayloadForAuthoring } from './authoring-payload';
import { LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, parseMarkdownActivityPayload, LESSON_ACTIVITY_MARKDOWN_MAX_LEN } from './markdown-activity-payload';
import { LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, parseMediaActivityPayload } from './media-activity-payload';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../../lesson-execution/activity/objective-activity-payload';

const objective = {
  schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION,
  format: 'single_choice',
  prompt: 'Pick A',
  options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
  answerKey: { correctOptionIds: ['a'] },
};

describe('parseMarkdownActivityPayload (lesson-activity-markdown/v1)', () => {
  it('accepts { schemaVersion, markdown } and trims', () => {
    expect(parseMarkdownActivityPayload({ schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '  # Hi  ' })).toEqual({ schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '# Hi' });
  });
  it.each([
    ['wrong schemaVersion', { schemaVersion: 'x', markdown: 'a' }],
    ['empty markdown', { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '   ' }],
    ['non-string markdown', { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: 5 }],
    ['extra key (rawHtml)', { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: 'a', rawHtml: '<b>' }],
    ['missing markdown', { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION }],
    ['too long', { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: 'x'.repeat(LESSON_ACTIVITY_MARKDOWN_MAX_LEN + 1) }],
    ['array', []],
    ['null', null],
  ])('rejects %s', (_l, bad) => expect(() => parseMarkdownActivityPayload(bad)).toThrow(ContentActivityPayloadInvalidError));
});

describe('parseMediaActivityPayload (lesson-activity-media/v1)', () => {
  it('accepts the bare marker', () => {
    expect(parseMediaActivityPayload({ schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION })).toEqual({ schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION });
  });
  it.each([
    ['wrong schemaVersion', { schemaVersion: 'x' }],
    ['mediaAssetId leak', { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, mediaAssetId: '00000000-0000-7000-8000-000000000000' }],
    ['url leak', { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, url: 'https://x' }],
    ['storageKey leak', { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, storageKey: 'k' }],
    ['null', null],
  ])('rejects %s', (_l, bad) => expect(() => parseMediaActivityPayload(bad)).toThrow(ContentActivityPayloadInvalidError));
});

describe('validateActivityPayloadForAuthoring (canonical dispatcher, TD-248)', () => {
  it('objective types → validates via the canonical objective parser + returns normalized payload', () => {
    for (const t of [ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]) {
      const out = validateActivityPayloadForAuthoring(t, objective);
      expect(out.schemaVersion).toBe(LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION);
    }
  });
  it('invalid objective payload → ContentActivityPayloadInvalidError (no learner error leak)', () => {
    expect(() => validateActivityPayloadForAuthoring(ActivityType.MINI_QUESTION, { ...objective, answerKey: { correctOptionIds: ['z'] } })).toThrow(ContentActivityPayloadInvalidError);
  });
  it('markdown types → markdown contract', () => {
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]) {
      expect(validateActivityPayloadForAuthoring(t, { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: 'Hello' }).schemaVersion).toBe(LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION);
    }
  });
  it('media types → media marker contract', () => {
    for (const t of [ActivityType.IMAGE, ActivityType.AUDIO]) {
      expect(validateActivityPayloadForAuthoring(t, { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION }).schemaVersion).toBe(LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION);
    }
  });
  it('unsupported types → ContentActivityTypeNotAuthorableError', () => {
    for (const t of [ActivityType.SPEAKING, ActivityType.WRITING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO]) {
      expect(() => validateActivityPayloadForAuthoring(t, { anything: true })).toThrow(ContentActivityTypeNotAuthorableError);
    }
  });
  it('wrong contract payload for a type is rejected (markdown body under an objective type)', () => {
    expect(() => validateActivityPayloadForAuthoring(ActivityType.MINI_QUESTION, { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: 'x' })).toThrow(ContentActivityPayloadInvalidError);
  });
});
