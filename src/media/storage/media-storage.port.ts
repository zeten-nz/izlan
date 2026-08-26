/**
 * MediaStoragePort — the ONE storage boundary (TD-25/74/82). The rest of the app knows only opaque, provider-neutral
 * storage keys; it never sees URLs, buckets, or filesystem paths. A local-dev adapter and (future) an S3-compatible
 * adapter both implement this. No production vendor is chosen here.
 */
export const MEDIA_STORAGE_PORT = Symbol('MEDIA_STORAGE_PORT');

export interface MediaStoragePort {
  /** Persist bytes under an opaque storage key (throws MediaStorageUnavailableError if no real store is configured). */
  put(storageKey: string, bytes: Buffer): Promise<void>;
  /** Read bytes for a key; null when the object does not exist. */
  read(storageKey: string): Promise<Buffer | null>;
  /** Best-effort delete (idempotent; never throws for a missing object). */
  delete(storageKey: string): Promise<void>;
}
