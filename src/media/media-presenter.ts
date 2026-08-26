import { mediaKindForMime } from './media.constants';

/**
 * Media views that NEVER carry storageKey, uploader, storage path or moderation internals.
 * `UploadedAsset` is the reusable file identity (upload result) — alt text is NOT part of it, because alt text is
 * contextual and lives on the attachment. `SafeMedia` is the attachment view (list / learner projection) and carries
 * the per-attachment `altText` sourced from ActivityMedia.
 */
export interface UploadedAsset {
  id: string; // the MediaAsset id — fetch bytes via GET /api/media/:id/content, then attach to an activity
  kind: string; // 'image' | 'audio'
  mimeType: string;
}

export interface SafeMedia extends UploadedAsset {
  altText: string | null; // from ActivityMedia (this attachment context), never from MediaAsset
}

export function toUploadedAsset(a: { id: string; mimeType: string }): UploadedAsset {
  return { id: a.id, kind: mediaKindForMime(a.mimeType) ?? 'other', mimeType: a.mimeType };
}

export function toSafeMedia(a: { id: string; mimeType: string; altText: string | null }): SafeMedia {
  return { id: a.id, kind: mediaKindForMime(a.mimeType) ?? 'other', mimeType: a.mimeType, altText: a.altText ?? null };
}
