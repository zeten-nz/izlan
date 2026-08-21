/**
 * lesson-activity-markdown/v1 serializer + validator. Mirrors the backend contract
 * (src/content/activity/markdown-activity-payload.ts): EXACTLY { schemaVersion, markdown }; markdown is a
 * trimmed non-empty string, max 50 000 chars; NO rawHtml/html field ever. Raw HTML rendering stays disabled.
 */
export const LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION = 'lesson-activity-markdown/v1';
export const LESSON_ACTIVITY_MARKDOWN_MAX_LEN = 50_000;

export interface MarkdownActivityPayload {
  schemaVersion: typeof LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION;
  markdown: string;
}

export function serializeMarkdownPayload(markdown: string): MarkdownActivityPayload {
  return { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: markdown.trim() };
}

/** True iff the object is EXACTLY a canonical markdown payload the backend parser would accept. */
export function isCanonicalMarkdownPayload(raw: unknown): raw is MarkdownActivityPayload {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes('schemaVersion') || !keys.includes('markdown')) return false;
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION) return false;
  if (typeof p.markdown !== 'string') return false;
  const trimmed = p.markdown.trim();
  return trimmed.length > 0 && trimmed.length <= LESSON_ACTIVITY_MARKDOWN_MAX_LEN;
}

export function markdownValidationError(markdown: string): string | null {
  const trimmed = markdown.trim();
  if (trimmed.length === 0) return 'Matn bo‘sh bo‘lishi mumkin emas.';
  if (trimmed.length > LESSON_ACTIVITY_MARKDOWN_MAX_LEN) return `Matn ${LESSON_ACTIVITY_MARKDOWN_MAX_LEN} belgidan oshmasligi kerak.`;
  return null;
}
