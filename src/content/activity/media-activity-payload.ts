import { ContentActivityPayloadInvalidError } from '../../common/errors';

/**
 * lesson-activity-media/v1 (Phase 2.2A-2, TD-248) — the authoring payload contract for the media view-only Activity
 * types (IMAGE / AUDIO). The payload is a MARKER ONLY: `{ schemaVersion }`. Media identity stays RELATIONAL through
 * `ActivityMedia → MediaAsset` — the payload NEVER carries mediaAssetId / storageKey / URL / signed URL, and no
 * caption / transcript / altText / role (deliberately not decided here). STRICT: any extra key is rejected.
 *
 * A structurally-valid IMAGE/AUDIO DRAFT is NOT yet publish-ready (no media attached); DRAFT VALIDITY ≠ PUBLISH
 * READINESS — 2.2B publish validation closes required-media rules.
 */
export const LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION = 'lesson-activity-media/v1';

export interface MediaActivityPayload {
  schemaVersion: string;
}

function fail(): never {
  throw new ContentActivityPayloadInvalidError('activity payload invalid');
}

export function parseMediaActivityPayload(raw: unknown): MediaActivityPayload {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION) fail();
  // strict marker: schemaVersion ONLY — reject mediaAssetId / storageKey / url / any extra field
  for (const k of Object.keys(p)) if (k !== 'schemaVersion') fail();
  return { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION };
}
