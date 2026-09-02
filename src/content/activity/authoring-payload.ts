import { ActivityType } from '@prisma/client';
import { ContentActivityPayloadInvalidError, ContentActivityTypeNotAuthorableError } from '../../common/errors';
import { getActivityDefinition } from './activity-registry';
import { parseObjectiveActivityPayload } from '../../lesson-execution/activity/objective-activity-payload';
import { parseMarkdownActivityPayload } from './markdown-activity-payload';
import { parseMediaActivityPayload } from './media-activity-payload';
import { isStructuredSchema, parseStructuredActivityPayload } from './structured-activity-payload';
import { isListeningSchema, parseListeningActivityPayload } from './listening-activity-payload';
import { isReadingSchema, parseReadingActivityPayload } from './reading-activity-payload';

/**
 * ONE canonical authoring-time Activity payload dispatcher (Phase 2.2A-2, §18/TD-248). It consumes the canonical
 * registry (`getActivityDefinition(type).payloadContract`) and delegates to the matching validator — no ActivityType
 * classification list is duplicated here. Returns the NORMALIZED payload to store (validated shape). Fails safe:
 * never leaks payload / answerKey / parser internals.
 *
 * - LESSON_OBJECTIVE_V1 → the canonical learner objective parser (`lesson-activity-objective/v1`); its learner-domain
 *   `ActivityPayloadInvalidError` is adapted to `ContentActivityPayloadInvalidError` (400) so learner runtime semantics
 *   are untouched. The full objective payload (incl. answerKey) is stored server-side.
 * - LESSON_MARKDOWN_V1 → `parseMarkdownActivityPayload`. LESSON_MEDIA_V1 → `parseMediaActivityPayload`.
 * - NONE_DEFINED → the type is not authorable in v1 (SPEAKING/WRITING/LISTENING/AI_INTERACTION/VIDEO) → reject.
 */
export function validateActivityPayloadForAuthoring(type: ActivityType, raw: unknown): Record<string, unknown> {
  const { payloadContract } = getActivityDefinition(type);
  switch (payloadContract) {
    case 'LESSON_OBJECTIVE_V1':
      // The objective/deterministic FAMILY: choice (lesson-activity-objective/v1) OR structured production
      // (lesson-activity-structured/v1) — dispatched by schemaVersion. Both are deterministically scored and
      // learner-projected answer-key-free; the pedagogical role stays the ActivityType (MINI_QUESTION/PRACTICE/…).
      try {
        if (isStructuredSchema(raw)) return parseStructuredActivityPayload(raw) as unknown as Record<string, unknown>;
        if (isListeningSchema(raw)) return parseListeningActivityPayload(raw) as unknown as Record<string, unknown>;
        if (isReadingSchema(raw)) return parseReadingActivityPayload(raw) as unknown as Record<string, unknown>;
        return parseObjectiveActivityPayload(raw) as unknown as Record<string, unknown>;
      } catch {
        throw new ContentActivityPayloadInvalidError('activity payload invalid');
      }
    case 'LESSON_MARKDOWN_V1':
      return parseMarkdownActivityPayload(raw) as unknown as Record<string, unknown>;
    case 'LESSON_MEDIA_V1':
      return parseMediaActivityPayload(raw) as unknown as Record<string, unknown>;
    case 'NONE_DEFINED':
      throw new ContentActivityTypeNotAuthorableError('activity type is not authorable');
  }
}

/** Safe accessor for the stored payload's schemaVersion (for audit metadata only — never the body). */
export function payloadSchemaVersion(payload: Record<string, unknown>): string | undefined {
  const v = payload.schemaVersion;
  return typeof v === 'string' ? v : undefined;
}
