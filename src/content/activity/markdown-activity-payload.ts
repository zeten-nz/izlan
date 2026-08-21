import { ContentActivityPayloadInvalidError } from '../../common/errors';

/**
 * lesson-activity-markdown/v1 (Phase 2.2A-2, TD-248) — the authoring payload contract for the prose view-only
 * Activity types (TEXT / EXPLANATION / EXAMPLE). RESTRICTED MARKDOWN content authority: the ONLY fields are
 * `schemaVersion` and `markdown`. There is deliberately NO `rawHtml` / `html` / `trustedHtml` field. This backend
 * owns the STORAGE contract only — the future renderer must render Markdown with raw HTML disabled/sanitized.
 * STRICT: any unknown key is rejected. Fails safe (never leaks the body in the error).
 */
export const LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION = 'lesson-activity-markdown/v1';

/** Abuse bound — a single activity's markdown body cannot be arbitrarily large. */
export const LESSON_ACTIVITY_MARKDOWN_MAX_LEN = 50_000;

export interface MarkdownActivityPayload {
  schemaVersion: string;
  markdown: string;
}

function fail(): never {
  throw new ContentActivityPayloadInvalidError('activity payload invalid');
}

export function parseMarkdownActivityPayload(raw: unknown): MarkdownActivityPayload {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION) fail();
  if (typeof p.markdown !== 'string') fail();
  // strict: exactly { schemaVersion, markdown } — reject rawHtml/html/any extra field
  for (const k of Object.keys(p)) if (k !== 'schemaVersion' && k !== 'markdown') fail();
  const markdown = p.markdown.trim();
  if (markdown.length === 0 || markdown.length > LESSON_ACTIVITY_MARKDOWN_MAX_LEN) fail();
  return { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown };
}
