import { ActivityType } from '@prisma/client';
import { getActivityDefinition } from './activity-registry';
import { parseObjectiveActivityPayload, projectActivityForLearner } from '../../lesson-execution/activity/objective-activity-payload';
import { parseMarkdownActivityPayload } from './markdown-activity-payload';

/**
 * ONE shared learner-safe Activity projector (Phase 2.2B, §32) used by BOTH staff preview and LessonExecution runtime.
 * Registry-driven (`learnerProjection`), so there is no duplicated objective/markdown projection logic:
 *  - OBJECTIVE_SAFE → learner-safe objective question (answerKey STRIPPED via the canonical objective projector)
 *  - MARKDOWN_SAFE  → validated `{ schemaVersion, markdown }` (TEXT/EXPLANATION/EXAMPLE)
 *  - METADATA_ONLY  → identity/type/position only (IMAGE/AUDIO media; deferred types); never storageKey/URL
 * Malformed stored payload → safe metadata-only fallback (never leaks the raw body).
 */
export interface LearnerActivityInput {
  id: string;
  type: ActivityType;
  position: number;
  payload: unknown;
}

export type LearnerProjectedActivity =
  | { id: string; type: string; position: number }
  | { id: string; type: string; position: number; format: string; prompt: string; options: { id: string; text: string }[] }
  | { id: string; type: string; position: number; schemaVersion: string; markdown: string };

export function projectActivityForLearnerRuntime(a: LearnerActivityInput): LearnerProjectedActivity {
  const meta = { id: a.id, type: a.type as string, position: a.position };
  const projection = getActivityDefinition(a.type).learnerProjection;
  if (projection === 'OBJECTIVE_SAFE') {
    try {
      const payload = parseObjectiveActivityPayload(a.payload);
      return projectActivityForLearner(a.id, a.type, a.position, payload); // {id,type,position,format,prompt,options} — no answerKey
    } catch {
      return meta;
    }
  }
  if (projection === 'MARKDOWN_SAFE') {
    try {
      const md = parseMarkdownActivityPayload(a.payload);
      return { ...meta, schemaVersion: md.schemaVersion, markdown: md.markdown };
    } catch {
      return meta;
    }
  }
  return meta; // METADATA_ONLY
}
