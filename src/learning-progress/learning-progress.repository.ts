import { Injectable } from '@nestjs/common';
import { Prisma, SkillMeasurementSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NormalizedMeasurement } from './merge/merge-core';
import { MERGE_V2_SUPPORTED_SOURCES } from './merge/learning-progress-merge-v2.engine';

const SUPPORTED_SOURCE_LIST = [...MERGE_V2_SUPPORTED_SOURCES] as SkillMeasurementSource[]; // current engine = merge-v2 (includes REVIEW_MASTERY)

export interface StateUpsert {
  userId: string;
  skillId: string;
  masteryScoreBp: number;
  confidenceBp: number;
  evidenceCount: number;
  lastMeasurementAt: Date;
}

/**
 * Learning Progress persistence. Reads append-only SkillMeasurement history and is the SINGLE writer of
 * the mutable LearnerSkillState projection (TD-115). Never mutates SkillMeasurement at runtime (§61).
 */
@Injectable()
export class LearningProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Transaction-scoped per (user, skill) serialization (§31/32). hashtext args are bound parameters — no
   *  raw interpolation; a hash collision only adds serialization, never corruption. Auto-released at commit. */
  async advisoryLock(tx: Prisma.TransactionClient, userId: string, skillId: string): Promise<void> {
    // $executeRaw (not $queryRaw) — pg_advisory_xact_lock returns void, which the query deserializer rejects;
    // executeRaw runs it and returns a row count instead. Args are bound parameters (no raw interpolation).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${skillId}))`;
  }

  /** All merge-supported AND currently-admissible measurements for a user+skill (append-only history read).
   *  Admissibility is DERIVED: a measurement is excluded iff its raw evidence was produced against an artifact
   *  scoped by an ACTIVE INVALIDATED EvidenceIntegrityDecision (Content Quality §35a). History is never mutated;
   *  with no active integrity decision the exclusion is empty and the read is byte-identical to before. */
  async supportedMeasurements(userId: string, skillId: string, tx: Prisma.TransactionClient): Promise<NormalizedMeasurement[]> {
    const inadmissible = await this.inadmissibleScope(tx);
    const evidenceExclusion =
      inadmissible === null
        ? {}
        : {
            NOT: {
              evidenceRefs: {
                some: {
                  OR: [
                    ...(inadmissible.activityIds.length ? [{ activityAttempt: { activityId: { in: inadmissible.activityIds } } }] : []),
                    ...(inadmissible.itemIds.length ? [{ assessmentResponse: { itemId: { in: inadmissible.itemIds } } }] : []),
                  ],
                },
              },
            },
          };
    const rows = await tx.skillMeasurement.findMany({
      where: { userId, skillId, source: { in: SUPPORTED_SOURCE_LIST }, ...evidenceExclusion },
      select: { id: true, source: true, scoreBp: true, confidenceBp: true, evidenceCount: true, observedAt: true },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      scoreBp: r.scoreBp,
      confidenceBp: r.confidenceBp ?? -1, // null violates the normalized contract → engine reports config-invalid (§38)
      evidenceCount: r.evidenceCount,
      observedAt: r.observedAt,
    }));
  }

  /** Activity/item ids scoped by ACTIVE (not superseded) INVALIDATED integrity decisions, or null when none. */
  private async inadmissibleScope(tx: Prisma.TransactionClient): Promise<{ activityIds: string[]; itemIds: string[] } | null> {
    const invalidatedCount = await tx.evidenceIntegrityDecision.count({ where: { outcome: 'INVALIDATED' } });
    if (invalidatedCount === 0) return null; // V1 fast path — no integrity decisions, identical behavior
    const superseded = await tx.evidenceIntegrityDecision.findMany({ where: { supersedesDecisionId: { not: null } }, select: { supersedesDecisionId: true } });
    const supersededIds = superseded.map((r) => r.supersedesDecisionId).filter((x): x is string => x !== null);
    const active = await tx.evidenceIntegrityDecision.findMany({ where: { outcome: 'INVALIDATED', id: { notIn: supersededIds.length ? supersededIds : ['00000000-0000-0000-0000-000000000000'] } }, select: { id: true } });
    if (active.length === 0) return null;
    const scopes = await tx.evidenceIntegrityScope.findMany({ where: { decisionId: { in: active.map((d) => d.id) } }, select: { activityId: true, assessmentItemId: true } });
    const activityIds = scopes.map((s) => s.activityId).filter((x): x is string => x !== null);
    const itemIds = scopes.map((s) => s.assessmentItemId).filter((x): x is string => x !== null);
    if (activityIds.length === 0 && itemIds.length === 0) return null;
    return { activityIds, itemIds };
  }

  /** The (userId, skillId) pairs whose measurements draw on the given defective artifacts — the recompute set. */
  async affectedUserSkills(activityIds: string[], itemIds: string[]): Promise<{ userId: string; skillId: string }[]> {
    if (activityIds.length === 0 && itemIds.length === 0) return [];
    const rows = await this.prisma.skillMeasurement.findMany({
      where: {
        evidenceRefs: {
          some: {
            OR: [
              ...(activityIds.length ? [{ activityAttempt: { activityId: { in: activityIds } } }] : []),
              ...(itemIds.length ? [{ assessmentResponse: { itemId: { in: itemIds } } }] : []),
            ],
          },
        },
      },
      select: { userId: true, skillId: true },
      distinct: ['userId', 'skillId'],
    });
    return rows.map((r) => ({ userId: r.userId, skillId: r.skillId }));
  }

  /** Materialize the current state (single writer). Held under the advisory lock in the same tx. */
  async upsertState(tx: Prisma.TransactionClient, s: StateUpsert): Promise<void> {
    const data = { masteryScoreBp: s.masteryScoreBp, confidenceBp: s.confidenceBp, evidenceCount: s.evidenceCount, displayLevel: null, lastMeasurementAt: s.lastMeasurementAt };
    await tx.learnerSkillState.upsert({
      where: { userId_skillId: { userId: s.userId, skillId: s.skillId } },
      create: { userId: s.userId, skillId: s.skillId, ...data },
      update: data,
    });
  }

  getSubject(subjectId: string) {
    return this.prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, title: true } });
  }

  /** Skills in the subject that have merge-supported evidence OR an existing state (deterministic order). */
  async subjectSkillIdsForRecompute(userId: string, subjectId: string): Promise<string[]> {
    const rows = await this.prisma.skill.findMany({
      where: {
        subjectId,
        OR: [{ skillMeasurements: { some: { userId, source: { in: SUPPORTED_SOURCE_LIST } } } }, { skillStates: { some: { userId } } }],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Current states for a subject's skills (response projection; deterministic order). */
  subjectStates(userId: string, subjectId: string) {
    return this.prisma.learnerSkillState.findMany({
      where: { userId, skill: { subjectId } },
      orderBy: [{ skill: { sortOrder: 'asc' } }, { skill: { name: 'asc' } }, { skillId: 'asc' }],
      select: { skillId: true, masteryScoreBp: true, confidenceBp: true, evidenceCount: true, displayLevel: true, lastMeasurementAt: true },
    });
  }
}
