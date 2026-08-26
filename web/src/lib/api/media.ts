import { apiRequest, apiBase, refreshAccessToken } from './client';
import { getAccessToken } from '../auth/token-store';
import { ApiError, NetworkError, UnauthenticatedError } from './errors';

/**
 * Lesson media client. Uploads/downloads use raw authed fetch (multipart body / binary response), NOT apiRequest which
 * is JSON-only. The access token is memory-only, so media bytes are fetched with the Authorization header into a Blob
 * and exposed as an object URL — never a public/token-in-query URL. Attach/detach/list are ordinary JSON calls.
 */

/** The reusable asset returned by upload — no alt text (alt text is contextual and set at attach time). */
export interface UploadedMedia {
  id: string; // MediaAsset id — attach this, and fetch bytes via GET /api/media/:id/content
  kind: string; // 'image' | 'audio'
  mimeType: string;
}

/** An attachment as listed for an activity — carries the per-attachment alt text (from ActivityMedia). */
export interface AttachedMedia extends UploadedMedia {
  altText: string | null;
}

/** One authed fetch with a single 401 → refresh → retry (mirrors apiRequest, for non-JSON bodies/responses). */
async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${apiBase()}${path}`;
  const run = (token: string | null): Promise<Response> =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let res: Response;
  try {
    res = await run(getAccessToken());
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (!token) throw new UnauthenticatedError();
    res = await run(token);
    if (res.status === 401) throw new UnauthenticatedError();
  }
  return res;
}

async function throwFromResponse(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  throw new ApiError(res.status, body?.code ?? 'MEDIA_ERROR', body?.message ?? res.statusText ?? 'request failed');
}

/** POST /api/staff/content/media — real multipart upload of the file bytes only (no alt text; that's set at attach). */
export async function uploadMedia(file: File): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('file', file);
  const res = await authedFetch('/api/staff/content/media', { method: 'POST', body: form });
  if (!res.ok) return throwFromResponse(res);
  return res.json() as Promise<UploadedMedia>;
}

/** Attach an uploaded asset to a DRAFT activity. altText is contextual to this attachment; the server requires it for images. */
export function attachActivityMedia(activityId: string, mediaAssetId: string, expectedRevisionUpdatedAt: string, altText?: string): Promise<{ revisionUpdatedAt: string }> {
  return apiRequest(`/api/staff/content/activities/${activityId}/media`, { method: 'POST', body: { mediaAssetId, expectedRevisionUpdatedAt, ...(altText && altText.trim().length > 0 ? { altText: altText.trim() } : {}) } });
}
export function detachActivityMedia(activityId: string, mediaAssetId: string, expectedRevisionUpdatedAt: string): Promise<{ revisionUpdatedAt: string }> {
  return apiRequest(`/api/staff/content/activities/${activityId}/media/${mediaAssetId}`, { method: 'DELETE', body: { expectedRevisionUpdatedAt } });
}
export function listActivityMedia(activityId: string): Promise<AttachedMedia[]> {
  return apiRequest(`/api/staff/content/activities/${activityId}/media`);
}

/** GET /api/media/:id/content → Blob → object URL. Caller MUST URL.revokeObjectURL when done. */
export async function fetchMediaObjectUrl(mediaAssetId: string): Promise<string> {
  const res = await authedFetch(`/api/media/${mediaAssetId}/content`, { method: 'GET' });
  if (!res.ok) return throwFromResponse(res);
  return URL.createObjectURL(await res.blob());
}
