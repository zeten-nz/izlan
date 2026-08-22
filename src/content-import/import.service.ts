import { Injectable } from '@nestjs/common';
import { ContentSource, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentImportError } from '../common/errors';
import { HierarchyRepository, isUniqueViolation } from '../content-authoring/hierarchy.repository';
import { PrerequisiteRepository } from '../content-authoring/prerequisite.repository';
import { SubjectScopeService } from '../content-authoring/subject-scope.service';
import { ContentAuditRepository } from '../content-authoring/content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from '../content-authoring/content-authoring.constants';
import { parseImportDocument } from './import-parser';
import { resolveAndValidate, type ImportResolution } from './import-validator';
import { documentHash, IMPORT_SCHEMA_VERSION, IMPORT_STATUS, type ImportIssue, type ImportPlan, type ImportSummary } from './import-contract';
import { ImportRepository } from './import.repository';

/** Chunk size for large junction inserts — bounds any single createMany so a near-limit package never emits one
 *  unbounded 250k-row INSERT. All chunks still run inside the SAME import transaction (no partial commit). */
const INSERT_CHUNK = 1000;

/** Bounded transaction budget for a near-limit batched package (5000 activities + ~25k mappings). This is HEADROOM for
 *  the batched write path — NOT a substitute for batching (the per-row round trips were eliminated). */
const IMPORT_TX_TIMEOUT_MS = 30_000;

function importErrorFor(issues: ImportIssue[]): ContentImportError {
  const primary = issues.find((i) => (IMPORT_STATUS[i.code] ?? 400) === 409) ?? issues[0]!; // prefer a DB-state conflict
  return new ContentImportError(primary.code, IMPORT_STATUS[primary.code] ?? 400);
}

interface WrittenBatch {
  lessons: { contentKey: string; lessonId: string; revisionId: string }[];
  counts: {
    createdSkillCount: number;
    createdLessonCount: number;
    createdRevisionCount: number;
    createdActivityCount: number;
    lessonSkillCount: number;
    activitySkillCount: number;
    prerequisiteCount: number;
  };
}

/**
 * Topic-scoped bulk content import (TD-253). VALIDATE is an advisory dry-run (no writes/lock/audit). APPLY reruns the
 * FULL validation inside ONE transaction that first FOR-UPDATE-locks the destination Subject (the SAME graph
 * serialization authority as ordinary prerequisite authoring), then creates everything (Skills / Lessons / initial
 * DRAFT revisions / Activities / LessonSkill / ActivitySkill / prerequisite edges) via BATCHED/chunked inserts + ONE
 * aggregate StaffAudit — all-or-nothing. Never publishes; never modifies existing content; never echoes payload/answerKey.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hierarchy: HierarchyRepository,
    private readonly prereqs: PrerequisiteRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
    private readonly repo: ImportRepository,
  ) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  /** Resolve Topic → Subject server-side and enforce content.author + SubjectAssignment (IDOR-safe 404). */
  private async requireTopicSubject(userId: string, topicId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const topic = await this.hierarchy.findTopicScoped(topicId, tx);
    return this.scope.requireScope(userId, topic ? topic.subjectId : null, tx); // ContentNotFound → 404
  }

  private referencedKeys(plan: ImportPlan): string[] {
    const keys = new Set<string>();
    for (const l of plan.lessons) {
      keys.add(l.contentKey);
      for (const k of l.prerequisiteContentKeys) keys.add(k);
    }
    return [...keys];
  }

  private async resolveSnapshot(subjectId: string, plan: ImportPlan, tx?: Prisma.TransactionClient) {
    const [existingLessons, subjectSkills, existingEdges] = await Promise.all([
      this.repo.lessonsByContentKeys(this.referencedKeys(plan), tx),
      this.repo.subjectSkills(subjectId, tx),
      this.prereqs.edgesForSubject(this.db(tx), subjectId),
    ]);
    return resolveAndValidate({ subjectId, plan, existingLessons, subjectSkills, existingEdges });
  }

  // ── Dry-run ──
  async validate(userId: string, topicId: string, body: unknown) {
    const subjectId = await this.requireTopicSubject(userId, topicId);
    const { plan, issues: structuralIssues } = parseImportDocument(body); // hard-throws on schema/limit/aggregate cap
    const hash = documentHash(plan);
    const { issues: dbIssues, summary } = await this.resolveSnapshot(subjectId, plan);
    const errors = [...structuralIssues, ...dbIssues];
    return { schemaVersion: IMPORT_SCHEMA_VERSION, documentHash: hash, valid: errors.length === 0, summary, errors, warnings: [] as ImportIssue[] };
  }

  // ── Atomic apply ──
  async apply(userId: string, topicId: string, body: unknown) {
    // §14: a CHEAP preliminary scope check BEFORE expensive parsing — an unassigned content.author actor cannot make
    // the server deeply validate a large foreign-Topic document. The authoritative check still runs inside the tx.
    await this.requireTopicSubject(userId, topicId);

    const { plan, issues: structuralIssues } = parseImportDocument(body); // pure work BEFORE the transaction (§68)
    const hash = documentHash(plan);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const subjectId = await this.requireTopicSubject(userId, topicId, tx); // authoritative re-check inside the tx
          await this.prereqs.lockSubject(tx, subjectId); // serialize graph mutations for this Subject (§25)

          const { issues: dbIssues, summary, resolution } = await this.resolveSnapshot(subjectId, plan, tx);
          const errors = [...structuralIssues, ...dbIssues];
          if (errors.length > 0) throw importErrorFor(errors); // authoritative revalidation — rolls back

          const written = await this.persistBatch(tx, { userId, topicId, subjectId, plan, resolution });

          await this.audit.write(tx, {
            actorUserId: userId,
            actionCode: CONTENT_AUDIT.IMPORT_APPLY,
            targetType: CONTENT_TARGET.TOPIC,
            targetId: topicId,
            metadata: { subjectId, topicId, documentHash: hash, ...written.counts }, // safe metadata only — no titles/payload/answerKey
          });

          return { schemaVersion: IMPORT_SCHEMA_VERSION, documentHash: hash, summary: summary satisfies ImportSummary, lessons: written.lessons };
        },
        { timeout: IMPORT_TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentImportError('IMPORT_CONFLICT', 409); // concurrency (contentKey / skill unique)
      throw e;
    }
  }

  /**
   * Batched persistence (§7-9). Every relation is created with createMany / createManyAndReturn — no per-row round
   * trips — and large junction sets are chunked. Ids are correlated by STABLE business keys (skill code, contentKey,
   * lessonId+version, revisionId+position), never by database return ordering.
   */
  private async persistBatch(
    tx: Prisma.TransactionClient,
    ctx: { userId: string; topicId: string; subjectId: string; plan: ImportPlan; resolution: ImportResolution },
  ): Promise<WrittenBatch> {
    const { userId, topicId, subjectId, plan, resolution } = ctx;

    // 1. Skills — create only those not reused from existing; resolve created ids by `code`.
    const skillIdByCode = new Map(resolution.existingSkillIdByCode);
    const skillsToCreate = plan.skills.filter((s) => !skillIdByCode.has(s.code));
    if (skillsToCreate.length > 0) {
      const created = await tx.skill.createManyAndReturn({
        data: skillsToCreate.map((s) => ({ subjectId, name: s.name, code: s.code, description: s.description, sortOrder: s.sortOrder })),
        select: { id: true, code: true },
      });
      for (const row of created) if (row.code) skillIdByCode.set(row.code, row.id);
    }

    // 2. Lessons — bulk; resolve ids by globally-unique contentKey.
    const lessonRows = await tx.lesson.createManyAndReturn({
      data: plan.lessons.map((l) => ({ topicId, contentKey: l.contentKey, slug: l.slug, sortOrder: l.sortOrder, createdBy: userId })),
      select: { id: true, contentKey: true },
    });
    const lessonIdByKey = new Map(lessonRows.map((r) => [r.contentKey, r.id]));

    // 3. Initial DRAFT revision (version 1) per Lesson — bulk; resolve ids by lessonId (one revision per lesson here).
    const revisionRows = await tx.lessonRevision.createManyAndReturn({
      data: plan.lessons.map((l) => ({
        lessonId: lessonIdByKey.get(l.contentKey)!,
        version: 1,
        title: l.revision.title,
        description: l.revision.description,
        status: RevisionStatus.DRAFT,
        createdBy: userId,
        updatedBy: userId,
      })),
      select: { id: true, lessonId: true },
    });
    const revisionIdByLessonId = new Map(revisionRows.map((r) => [r.lessonId, r.id]));
    const revisionIdForKey = (contentKey: string) => revisionIdByLessonId.get(lessonIdByKey.get(contentKey)!)!;

    // 4. Activities — bulk/chunked; resolve ids by (revisionId, position) which is @@unique.
    // Provenance (TD-254): every Activity in the package inherits the normalized package source (default HUMAN).
    // aiMetadata is NOT accepted in v1 and is omitted → SQL NULL. Human review does not rewrite the origin.
    const source = plan.provenance.source as ContentSource;
    const activityData: Prisma.ActivityCreateManyInput[] = [];
    for (const l of plan.lessons) {
      const revId = revisionIdForKey(l.contentKey);
      l.revision.activities.forEach((a, pos) => {
        activityData.push({
          lessonRevisionId: revId,
          type: a.type,
          position: pos,
          payload: a.payload as Prisma.InputJsonValue,
          estimatedDurationMin: a.estimatedDurationMin,
          source, // aiMetadata omitted → SQL NULL
        });
      });
    }
    const activityIdByRevPos = new Map<string, string>();
    const activityRows = await chunkedCreateReturn(activityData, (chunk) =>
      tx.activity.createManyAndReturn({ data: chunk, select: { id: true, lessonRevisionId: true, position: true } }),
    );
    for (const r of activityRows) activityIdByRevPos.set(`${r.lessonRevisionId}:${r.position}`, r.id);

    // 5. LessonSkill — bulk/chunked (lists already de-duplicated by the parser).
    const lessonSkillData: Prisma.LessonSkillCreateManyInput[] = [];
    for (const l of plan.lessons) {
      const lessonId = lessonIdByKey.get(l.contentKey)!;
      for (const code of l.skillCodes) lessonSkillData.push({ lessonId, skillId: skillIdByCode.get(code)! });
    }
    await chunkedCreate(lessonSkillData, (chunk) => tx.lessonSkill.createMany({ data: chunk }));

    // 6. ActivitySkill — bulk/chunked.
    const activitySkillData: Prisma.ActivitySkillCreateManyInput[] = [];
    for (const l of plan.lessons) {
      const revId = revisionIdForKey(l.contentKey);
      l.revision.activities.forEach((a, pos) => {
        const activityId = activityIdByRevPos.get(`${revId}:${pos}`)!;
        for (const code of a.skillCodes) activitySkillData.push({ activityId, skillId: skillIdByCode.get(code)! });
      });
    }
    await chunkedCreate(activitySkillData, (chunk) => tx.activitySkill.createMany({ data: chunk }));

    // 7. Prerequisite edges — bulk/chunked; targets are new (this batch) or existing same-Subject lessons.
    const targetIdForKey = (key: string) => lessonIdByKey.get(key) ?? resolution.existingLessonIdByContentKey.get(key)!;
    const prereqData: Prisma.LessonPrerequisiteCreateManyInput[] = [];
    for (const l of plan.lessons) {
      const lessonId = lessonIdByKey.get(l.contentKey)!;
      for (const key of l.prerequisiteContentKeys) prereqData.push({ lessonId, prerequisiteLessonId: targetIdForKey(key) });
    }
    await chunkedCreate(prereqData, (chunk) => tx.lessonPrerequisite.createMany({ data: chunk }));

    const lessons = plan.lessons.map((l) => {
      const lessonId = lessonIdByKey.get(l.contentKey)!;
      return { contentKey: l.contentKey, lessonId, revisionId: revisionIdByLessonId.get(lessonId)! };
    });

    // Counts are derived from the exact rows written → deterministically match the dry-run summary (§11).
    return {
      lessons,
      counts: {
        createdSkillCount: skillsToCreate.length,
        createdLessonCount: plan.lessons.length,
        createdRevisionCount: plan.lessons.length,
        createdActivityCount: activityData.length,
        lessonSkillCount: lessonSkillData.length,
        activitySkillCount: activitySkillData.length,
        prerequisiteCount: prereqData.length,
      },
    };
  }
}

/** Run `create` over `rows` in bounded chunks (no return value collected). */
async function chunkedCreate<T>(rows: T[], create: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) await create(rows.slice(i, i + INSERT_CHUNK));
}
/** Run `create` over `rows` in bounded chunks, concatenating the returned rows (order-independent correlation upstream). */
async function chunkedCreateReturn<T, R>(rows: T[], create: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) out.push(...(await create(rows.slice(i, i + INSERT_CHUNK))));
  return out;
}
