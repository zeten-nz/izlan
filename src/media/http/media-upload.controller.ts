import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart'; // registers the `req.file()` type augmentation
import { RequirePermissions, CurrentPrincipal } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { CONTENT_AUTHOR } from '../../content-authoring/content-authoring.constants';
import { MediaTooLargeError, MediaUploadInvalidError } from '../../common/errors';
import { MediaService } from '../media.service';

/**
 * Staff media upload (§6). `content.author` (no Subject scope here — media is subject-agnostic until ATTACHED, and the
 * attach endpoint enforces SubjectAssignment). Real multipart/form-data: a single `file` part. Never base64-in-JSON.
 * Alt text is NOT part of upload — it is contextual and provided at attach time (stored on ActivityMedia). Returns
 * the reusable asset (id/kind/mimeType) — never the storageKey.
 */
@Controller('staff/content')
export class MediaUploadController {
  constructor(private readonly media: MediaService) {}

  @Post('media')
  @RequirePermissions(CONTENT_AUTHOR)
  @HttpCode(201)
  async upload(@CurrentPrincipal() p: AuthPrincipal, @Req() req: FastifyRequest) {
    const data = await req.file().catch(() => undefined);
    if (!data) throw new MediaUploadInvalidError('no file');
    let bytes: Buffer;
    try {
      bytes = await data.toBuffer(); // throws if the streaming fileSize limit is exceeded
    } catch {
      throw new MediaTooLargeError('too large');
    }
    return this.media.upload(p.userId, { bytes, declaredMime: data.mimetype });
  }
}
