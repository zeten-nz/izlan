import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MediaAssetNotFoundError } from '../../common/errors';
import { MediaService } from '../media.service';

/**
 * Authenticated media download (§15/§16). The global AuthGuard requires a valid Bearer token, so an ordinary
 * <img src>/<audio src> cannot load this directly — the web client fetches the bytes through its authenticated
 * transport into a Blob/object URL. Streams the raw bytes with the stored Content-Type; never exposes the storageKey,
 * filesystem path or a downloadable filename. Deterministic 404 for an unknown/absent asset.
 */
@Controller('media')
export class MediaContentController {
  constructor(private readonly media: MediaService) {}

  @Get(':mediaAssetId/content')
  async content(@Param('mediaAssetId', ParseUUIDPipe) mediaAssetId: string, @Res() reply: FastifyReply): Promise<void> {
    const found = await this.media.readContent(mediaAssetId);
    if (!found) throw new MediaAssetNotFoundError('not found');
    void reply
      .header('Content-Type', found.mimeType)
      .header('Content-Disposition', 'inline') // no filename → nothing derived from the original upload name
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=300')
      .send(found.bytes);
  }
}
