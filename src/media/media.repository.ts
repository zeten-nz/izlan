import { Injectable } from '@nestjs/common';
import { MediaProcessingStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** MediaAsset persistence. INFRASTRUCTURE only — no policy (allowlist/size checks live in the service). */
@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Local storage writes synchronously, so an uploaded asset is READY immediately; moderation stays UNREVIEWED (no dev moderation pipeline). */
  create(data: { storageKey: string; mimeType: string; sizeBytes: number; uploadedBy: string }) {
    return this.prisma.mediaAsset.create({
      data: { ...data, processingStatus: MediaProcessingStatus.READY },
      select: { id: true, mimeType: true }, // alt text is NOT stored on the asset (it's per-attachment)
    });
  }

  findById(id: string) {
    return this.prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, mimeType: true, storageKey: true } });
  }
}
