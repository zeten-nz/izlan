import { MediaStorageUnavailableError } from '../../common/errors';
import type { MediaStoragePort } from './media-storage.port';

/**
 * Fail-closed default. Selected when no real storage is configured — notably PRODUCTION, where local disk is never a
 * valid store and no S3-compatible adapter has been built yet. Uploads fail with 503; reads return null (so an
 * already-authored asset simply 404s). The rest of the API keeps running when media is unused (§5).
 */
export class UnavailableMediaStorageAdapter implements MediaStoragePort {
  async put(): Promise<void> {
    throw new MediaStorageUnavailableError('media storage unavailable');
  }
  async read(): Promise<Buffer | null> {
    return null;
  }
  async delete(): Promise<void> {
    /* nothing stored */
  }
}
