import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MediaTooLargeError, MediaTypeNotAllowedError, MediaUploadInvalidError } from '../common/errors';
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from './storage/media-storage.port';
import { MediaRepository } from './media.repository';
import { toUploadedAsset, type UploadedAsset } from './media-presenter';
import { magicMatchesMime, maxBytesForKind, mediaKindForMime } from './media.constants';

/**
 * Lesson media service. Validates (allowlist + magic-byte anti-spoofing + per-type size), writes bytes through the
 * storage port under an OPAQUE key, then records a MediaAsset (the reusable file identity — NO alt text; alt text is
 * contextual and set at attach time on ActivityMedia). Reads bytes for the authenticated download route.
 * The storageKey never leaves this boundary (only id/kind/mimeType are returned).
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_STORAGE_PORT) private readonly storage: MediaStoragePort,
    private readonly repo: MediaRepository,
  ) {}

  async upload(userId: string, input: { bytes: Buffer; declaredMime: string }): Promise<UploadedAsset> {
    const { bytes, declaredMime } = input;
    if (!bytes || bytes.length === 0) throw new MediaUploadInvalidError('empty file');
    const kind = mediaKindForMime(declaredMime);
    if (!kind) throw new MediaTypeNotAllowedError('mime not allowed'); // not image/* or audio/* in the allowlist
    if (bytes.length > maxBytesForKind(kind)) throw new MediaTooLargeError('over size limit');
    if (!magicMatchesMime(declaredMime, bytes)) throw new MediaTypeNotAllowedError('magic mismatch'); // declared MIME must match real bytes

    const storageKey = randomUUID(); // opaque, provider-neutral; never derived from the filename
    await this.storage.put(storageKey, bytes);
    const asset = await this.repo.create({ storageKey, mimeType: declaredMime, sizeBytes: bytes.length, uploadedBy: userId });
    return toUploadedAsset(asset);
  }

  /** Authenticated download: resolve the asset, read its bytes via the port. Null → the controller 404s. */
  async readContent(mediaAssetId: string): Promise<{ mimeType: string; bytes: Buffer } | null> {
    const asset = await this.repo.findById(mediaAssetId);
    if (!asset) return null;
    const bytes = await this.storage.read(asset.storageKey);
    if (!bytes) return null;
    return { mimeType: asset.mimeType, bytes };
  }
}
