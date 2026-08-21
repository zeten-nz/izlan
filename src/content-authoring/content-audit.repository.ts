import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * StaffAudit writer for content authoring (Phase 2.2A-1, §18/19). ALWAYS called with the SAME Prisma
 * transaction client as the business mutation — the audit row and the mutation commit or roll back together.
 * There is no standalone (non-transactional) audit path here by design.
 *
 * metadata carries only safe provenance/diff (ids, changed field names + small metadata values) — never auth
 * tokens, raw request bodies, or sensitive data (§18).
 */
export interface AuditEntry {
  actorUserId: string;
  actionCode: string;
  targetType: string;
  targetId: string | null;
  reason?: string; // human return/takedown reason (§14/37/41) — stored in StaffAudit.reason, never a body dump
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class ContentAuditRepository {
  write(tx: Prisma.TransactionClient, entry: AuditEntry) {
    return tx.staffAudit.create({
      data: {
        actorUserId: entry.actorUserId,
        actionCode: entry.actionCode,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        metadata: entry.metadata,
      },
      select: { id: true },
    });
  }
}
