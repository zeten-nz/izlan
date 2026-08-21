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

  /** All merge-supported measurements for a user+skill (append-only history read). */
  async supportedMeasurements(userId: string, skillId: string, tx: Prisma.TransactionClient): Promise<NormalizedMeasurement[]> {
    const rows = await tx.skillMeasurement.findMany({
      where: { userId, skillId, source: { in: SUPPORTED_SOURCE_LIST } },
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
