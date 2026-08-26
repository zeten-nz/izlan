import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** ActivityMedia + MediaAsset lookups for attach/detach. INFRASTRUCTURE only (policy is in the service). */
@Injectable()
export class ActivityMediaRepository {
  constructor(private readonly prisma: PrismaService) {}
  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  /** Returns the asset's mimeType (used by the service to derive kind for the IMAGE-requires-alt rule), or null if absent. */
  async assetMime(tx: Prisma.TransactionClient, mediaAssetId: string): Promise<string | null> {
    const a = await this.db(tx).mediaAsset.findUnique({ where: { id: mediaAssetId }, select: { mimeType: true } });
    return a?.mimeType ?? null;
  }

  findLink(tx: Prisma.TransactionClient, activityId: string, mediaAssetId: string) {
    return this.db(tx).activityMedia.findUnique({ where: { activityId_mediaAssetId: { activityId, mediaAssetId } }, select: { id: true } });
  }

  async nextPosition(tx: Prisma.TransactionClient, activityId: string): Promise<number> {
    const r = await this.db(tx).activityMedia.aggregate({ where: { activityId }, _max: { position: true } });
    return (r._max.position ?? -1) + 1;
  }

  createLink(tx: Prisma.TransactionClient, data: { activityId: string; mediaAssetId: string; position: number; altText: string | null }) {
    return this.db(tx).activityMedia.create({ data });
  }

  deleteLink(tx: Prisma.TransactionClient, activityId: string, mediaAssetId: string) {
    return this.db(tx).activityMedia.deleteMany({ where: { activityId, mediaAssetId } });
  }

  /** Attached media for one activity, ordered — safe fields only (never storageKey). altText is per-attachment (this row). */
  async listForActivity(activityId: string): Promise<{ id: string; mimeType: string; altText: string | null }[]> {
    const rows = await this.db().activityMedia.findMany({
      where: { activityId },
      orderBy: { position: 'asc' },
      select: { altText: true, media: { select: { id: true, mimeType: true } } },
    });
    return rows.map((r) => ({ id: r.media.id, mimeType: r.media.mimeType, altText: r.altText }));
  }

  /** All attached media for a revision's activities, grouped by activityId (for the staff preview projection). */
  async mediaByRevision(revisionId: string): Promise<Map<string, { id: string; mimeType: string; altText: string | null }[]>> {
    const rows = await this.db().activityMedia.findMany({
      where: { activity: { lessonRevisionId: revisionId } },
      orderBy: { position: 'asc' },
      select: { activityId: true, altText: true, media: { select: { id: true, mimeType: true } } },
    });
    const map = new Map<string, { id: string; mimeType: string; altText: string | null }[]>();
    for (const r of rows) {
      const list = map.get(r.activityId) ?? [];
      list.push({ id: r.media.id, mimeType: r.media.mimeType, altText: r.altText });
      map.set(r.activityId, list);
    }
    return map;
  }
}
