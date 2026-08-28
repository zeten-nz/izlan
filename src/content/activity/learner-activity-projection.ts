import { ActivityType } from '@prisma/client';
import { getActivityDefinition } from './activity-registry';
import { parseObjectiveActivityPayload, projectActivityForLearner } from '../../lesson-execution/activity/objective-activity-payload';
import { parseMarkdownActivityPayload } from './markdown-activity-payload';
import { isStructuredSchema, parseStructuredActivityPayload, projectStructuredForLearner, type LearnerStructuredActivity } from './structured-activity-payload';
import { mediaKindForMime } from '../../media/media.constants';

/**
 * ONE shared learner-safe Activity projector (Phase 2.2B, §32) used by BOTH staff preview and LessonExecution runtime.
 * Registry-driven (`learnerProjection`), so there is no duplicated objective/markdown projection logic:
 *  - OBJECTIVE_SAFE → learner-safe objective question (answerKey STRIPPED via the canonical objective projector)
 *  - MARKDOWN_SAFE  → validated `{ schemaVersion, markdown }` (TEXT/EXPLANATION/EXAMPLE)
 *  - METADATA_ONLY  → identity/type/position only (IMAGE/AUDIO media; deferred types); never storageKey/URL
 * Malformed stored payload → safe metadata-only fallback (never leaks the raw body).
 */
/** Learner-safe media view for an activity — id/kind/mime/altText ONLY; never storageKey/path/uploader. */
export interface LearnerActivityMedia {
  id: string; // MediaAsset id — fetch bytes via GET /api/media/:id/content (authenticated)
  kind: string; // 'image' | 'audio'
  mimeType: string;
  altText: string | null;
}

export interface LearnerActivityInput {
  id: string;
  type: ActivityType;
  position: number;
  payload: unknown;
  /** Ordered attached media (from ActivityMedia join). Optional so callers that never attach media are unaffected. */
  media?: { id: string; mimeType: string; altText: string | null }[];
}

type LearnerProjectedBase =
  | { id: string; type: string; position: number }
  | { id: string; type: string; position: number; format: string; prompt: string; options: { id: string; text: string }[] }
  | { id: string; type: string; position: number; schemaVersion: string; markdown: string }
  | LearnerStructuredActivity;
export type LearnerProjectedActivity = LearnerProjectedBase & { media?: LearnerActivityMedia[] };

function projectMedia(media: LearnerActivityInput['media']): LearnerActivityMedia[] | undefined {
  if (!media || media.length === 0) return undefined;
  return media.map((m) => ({ id: m.id, kind: mediaKindForMime(m.mimeType) ?? 'other', mimeType: m.mimeType, altText: m.altText ?? null }));
}

export function projectActivityForLearnerRuntime(a: LearnerActivityInput): LearnerProjectedActivity {
  const meta = { id: a.id, type: a.type as string, position: a.position };
  const media = projectMedia(a.media);
  const withMedia = <T extends object>(v: T): T & { media?: LearnerActivityMedia[] } => (media ? { ...v, media } : v);
  const projection = getActivityDefinition(a.type).learnerProjection;
  if (projection === 'OBJECTIVE_SAFE') {
    try {
      // The objective/deterministic family: choice OR structured production, dispatched by schemaVersion. Both
      // project answer-key-free (accepted sets / correct order / remediation are never exposed).
      if (isStructuredSchema(a.payload)) {
        return withMedia(projectStructuredForLearner(a.id, a.type, a.position, parseStructuredActivityPayload(a.payload)));
      }
      return withMedia(projectActivityForLearner(a.id, a.type, a.position, parseObjectiveActivityPayload(a.payload))); // no answerKey
    } catch {
      return withMedia(meta);
    }
  }
  if (projection === 'MARKDOWN_SAFE') {
    try {
      const md = parseMarkdownActivityPayload(a.payload);
      return withMedia({ ...meta, schemaVersion: md.schemaVersion, markdown: md.markdown });
    } catch {
      return withMedia(meta);
    }
  }
  return withMedia(meta); // METADATA_ONLY
}
