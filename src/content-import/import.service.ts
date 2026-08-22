import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ContentImportError } from '../common/errors';
import { HierarchyRepository, isUniqueViolation } from '../content-authoring/hierarchy.repository';
import { RevisionRepository } from '../content-authoring/revision.repository';
import { ActivityRepository } from '../content-authoring/activity.repository';
import { SkillRepository } from '../content-authoring/skill.repository';
import { MappingRepository } from '../content-authoring/mapping.repository';
import { PrerequisiteRepository } from '../content-authoring/prerequisite.repository';
import { SubjectScopeService } from '../content-authoring/subject-scope.service';
import { ContentAuditRepository } from '../content-authoring/content-audit.repository';
import { CONTENT_AUDIT, CONTENT_TARGET } from '../content-authoring/content-authoring.constants';
import { parseImportDocument } from './import-parser';
import { resolveAndValidate } from './import-validator';
import { documentHash, IMPORT_SCHEMA_VERSION, IMPORT_STATUS, type ImportIssue, type ImportPlan, type ImportSummary } from './import-contract';
import { ImportRepository } from './import.repository';

function importErrorFor(issues: ImportIssue[]): ContentImportError {
  const primary = issues.find((i) => (IMPORT_STATUS[i.code] ?? 400) === 409) ?? issues[0]!; // prefer a DB-state conflict
  return new ContentImportError(primary.code, IMPORT_STATUS[primary.code] ?? 400);
}

/**
 * Topic-scoped bulk content import (TD-253). VALIDATE is an advisory dry-run (no writes/lock/audit). APPLY reruns the
 * FULL validation inside ONE transaction that first FOR-UPDATE-locks the destination Subject (the SAME graph
 * serialization authority as ordinary prerequisite authoring), then creates everything (Skills / Lessons / initial
 * DRAFT revisions / Activities / LessonSkill / ActivitySkill / prerequisite edges) + ONE aggregate StaffAudit —
 * all-or-nothing. Never publishes; never modifies existing content; never echoes payload / answerKey.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hierarchy: HierarchyRepository,
    private readonly revisions: RevisionRepository,
    private readonly activities: ActivityRepository,
    private readonly skills: SkillRepository,
    private readonly mappings: MappingRepository,
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
    const { plan, issues: structuralIssues } = parseImportDocument(body); // hard-throws on schema/limit
    const hash = documentHash(plan);
    const { issues: dbIssues, summary } = await this.resolveSnapshot(subjectId, plan);
    const errors = [...structuralIssues, ...dbIssues];
    return { schemaVersion: IMPORT_SCHEMA_VERSION, documentHash: hash, valid: errors.length === 0, summary, errors, warnings: [] as ImportIssue[] };
  }

  // ── Atomic apply ──
  async apply(userId: string, topicId: string, body: unknown) {
    const { plan, issues: structuralIssues } = parseImportDocument(body); // pure work BEFORE the transaction (§68)
    const hash = documentHash(plan);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const subjectId = await this.requireTopicSubject(userId, topicId, tx); // re-check scope inside the tx
        await this.prereqs.lockSubject(tx, subjectId); // serialize graph mutations for this Subject (§25)

        const { issues: dbIssues, summary, resolution } = await this.resolveSnapshot(subjectId, plan, tx);
        const errors = [...structuralIssues, ...dbIssues];
        if (errors.length > 0) throw importErrorFor(errors); // authoritative revalidation — rolls back

        // Skills: create only those not reused from existing.
        const skillIdByCode = new Map(resolution.existingSkillIdByCode);
        for (const s of plan.skills) {
          if (skillIdByCode.has(s.code)) continue;
          const created = await this.skills.createSkill(tx, { subjectId, name: s.name, code: s.code, description: s.description, sortOrder: s.sortOrder });
          skillIdByCode.set(s.code, created.id);
        }

        // Lessons + initial DRAFT revision + Activities + mappings.
        const lessonIdByKey = new Map<string, string>();
        const results: { contentKey: string; lessonId: string; revisionId: string }[] = [];
        let activityCount = 0;
        let lessonSkillCount = 0;
        let activitySkillCount = 0;

        for (const l of plan.lessons) {
          const lesson = await this.hierarchy.createLesson(tx, { topicId, contentKey: l.contentKey, slug: l.slug, sortOrder: l.sortOrder, createdBy: userId });
          lessonIdByKey.set(l.contentKey, lesson.id);
          const revision = await this.revisions.create(tx, { lessonId: lesson.id, version: 1, title: l.revision.title, description: l.revision.description, createdBy: userId });
          results.push({ contentKey: l.contentKey, lessonId: lesson.id, revisionId: revision.id });

          for (let pos = 0; pos < l.revision.activities.length; pos++) {
            const a = l.revision.activities[pos]!;
            const activity = await this.activities.create(tx, { lessonRevisionId: revision.id, type: a.type, position: pos, payload: a.payload as Prisma.InputJsonValue, estimatedDurationMin: a.estimatedDurationMin });
            activityCount++;
            for (const code of new Set(a.skillCodes)) {
              await this.mappings.createActivitySkill(tx, activity.id, skillIdByCode.get(code)!);
              activitySkillCount++;
            }
          }
          for (const code of new Set(l.skillCodes)) {
            await this.mappings.createLessonSkill(tx, lesson.id, skillIdByCode.get(code)!);
            lessonSkillCount++;
          }
        }

        // Prerequisite edges (after every lesson exists) — real ids for both new and existing targets.
        const lessonIdForKey = (key: string) => lessonIdByKey.get(key) ?? resolution.existingLessonIdByContentKey.get(key)!;
        let prerequisiteCount = 0;
        for (const l of plan.lessons) {
          const srcId = lessonIdByKey.get(l.contentKey)!;
          for (const key of l.prerequisiteContentKeys) {
            await this.prereqs.createEdge(tx, srcId, lessonIdForKey(key));
            prerequisiteCount++;
          }
        }

        const createdSkillCount = plan.skills.filter((s) => !resolution.existingSkillIdByCode.has(s.code)).length;
        await this.audit.write(tx, {
          actorUserId: userId,
          actionCode: CONTENT_AUDIT.IMPORT_APPLY,
          targetType: CONTENT_TARGET.TOPIC,
          targetId: topicId,
          metadata: {
            subjectId,
            topicId,
            documentHash: hash,
            createdSkillCount,
            createdLessonCount: results.length,
            createdRevisionCount: results.length,
            createdActivityCount: activityCount,
            lessonSkillCount,
            activitySkillCount,
            prerequisiteCount,
          },
        });

        return { schemaVersion: IMPORT_SCHEMA_VERSION, documentHash: hash, summary: summary satisfies ImportSummary, lessons: results };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ContentImportError('IMPORT_CONFLICT', 409); // concurrency (contentKey / skill unique)
      throw e;
    }
  }
}
