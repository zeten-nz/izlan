import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { MediaService } from './media.service';
import { MediaRepository } from './media.repository';
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from './storage/media-storage.port';
import { LocalMediaStorageAdapter } from './storage/local-media-storage.adapter';
import { UnavailableMediaStorageAdapter } from './storage/unavailable-media-storage.adapter';
import { MediaUploadController } from './http/media-upload.controller';
import { MediaContentController } from './http/media-content.controller';

/**
 * Media storage driver selection (mirrors SmsModule). `MEDIA_STORAGE_DRIVER=local` selects the gitignored local-disk
 * adapter — DEV/TEST ONLY; it is FORBIDDEN in production (local disk is never a production object store), where the
 * fail-closed adapter is used so uploads 503 without crashing the API. No production vendor is chosen here.
 */
export function selectMediaStorage(): MediaStoragePort {
  const driver = (process.env.MEDIA_STORAGE_DRIVER ?? '').trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  if (driver === 'local' && nodeEnv !== 'production') {
    const root = (process.env.MEDIA_LOCAL_ROOT ?? '').trim() || resolve(process.cwd(), 'data', 'media');
    return new LocalMediaStorageAdapter(root);
  }
  return new UnavailableMediaStorageAdapter();
}

@Module({
  controllers: [MediaUploadController, MediaContentController],
  providers: [MediaService, MediaRepository, { provide: MEDIA_STORAGE_PORT, useFactory: selectMediaStorage }],
  exports: [MediaService],
})
export class MediaModule {}
