import { Injectable } from '@nestjs/common';
import { AssessmentPurposeScope, ContainerStatus, Prisma, RevisionStatus, ActivityType, ContentSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from '../content-authoring/optimistic-concurrency';

const DEF_SELECT = {
  id: true, subjectId: true, purposeScope: true, title: true, description: true, status: true, currentVersionId: true, createdAt: true, updatedAt: true,
} as const;

const VER_SELECT = { id: true, definitionId: true, versionNo: true, config: true, status: true, publishedAt: true, updatedAt: true } as const;

/**
 * AssessmentDefinition / Version / Item persistence for authoring. INFRASTRUCTURE only — all policy (scope, lifecycle,
 * readiness, validation) lives in the service. Conditional writers advance `updatedAt` strictly (OCC), mirroring the
 * content-authoring PublishRepository. The learner runtime never touches this repository.
 */
@Injectable()
export class AssessmentAuthoringRepository {
  constructor(private readonly prisma: PrismaService) {}
  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  // ── Row locks (serialize concurrent create/publish) ──
  async lockSubject(tx: Prisma.TransactionClient, subjectId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "subject" WHERE id = ${subjectId}::uuid FOR UPDATE`;
    return rows.length > 0;
  }
  async lockDefinition(tx: Prisma.TransactionClient, definitionId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "assessment_definition" WHERE id = ${definitionId}::uuid FOR UPDATE`;
  }

  // ── Definition ──
  findDiagnosticBySubject(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinition.findFirst({ where: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC }, select: DEF_SELECT });
  }
  findDefinition(definitionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinition.findUnique({ where: { id: definitionId }, select: DEF_SELECT });
  }
  createDefinition(tx: Prisma.TransactionClient, data: { subjectId: string; title: string; description: string | null; createdBy: string }) {
    return tx.assessmentDefinition.create({
      data: { subjectId: data.subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, status: ContainerStatus.DRAFT, title: data.title, description: data.description, createdBy: data.createdBy },
      select: DEF_SELECT,
    });
  }
  updateDefinition(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: { title?: string; description?: string }) {
    return tx.assessmentDefinition.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  setCurrentVersion(tx: Prisma.TransactionClient, definitionId: string, versionId: string) {
    return tx.assessmentDefinition.update({ where: { id: definitionId }, data: { currentVersionId: versionId } });
  }
  setDefinitionStatus(tx: Prisma.TransactionClient, definitionId: string, from: ContainerStatus, to: ContainerStatus) {
    return tx.assessmentDefinition.updateMany({ where: { id: definitionId, status: from }, data: { status: to } });
  }

  // ── Version ──
  listVersions(definitionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findMany({ where: { definitionId }, orderBy: { versionNo: 'asc' }, select: { id: true, versionNo: true, status: true, publishedAt: true, updatedAt: true } });
  }
  findVersion(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findUnique({ where: { id: versionId }, select: VER_SELECT });
  }
  findEditableVersion(definitionId: string, tx: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findFirst({ where: { definitionId, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, select: { id: true, status: true } });
  }
  async maxVersionNo(definitionId: string, tx: Prisma.TransactionClient): Promise<number> {
    const r = await this.db(tx).assessmentDefinitionVersion.aggregate({ where: { definitionId }, _max: { versionNo: true } });
    return r._max.versionNo ?? 0;
  }
  createVersion(tx: Prisma.TransactionClient, data: { definitionId: string; versionNo: number; config: Prisma.InputJsonValue; createdBy: string }) {
    return tx.assessmentDefinitionVersion.create({ data: { definitionId: data.definitionId, versionNo: data.versionNo, config: data.config, status: RevisionStatus.DRAFT, createdBy: data.createdBy }, select: VER_SELECT });
  }
  countVersionItems(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentVersionItem.count({ where: { versionId } });
  }

  /** OCC touch/guard on a DRAFT version's token (create-item / reorder). Returns Prisma count. */
  touchDraftVersion(tx: Prisma.TransactionClient, versionId: string, expectedUpdatedAt: Date) {
    return tx.assessmentDefinitionVersion.updateMany({ where: { id: versionId, status: RevisionStatus.DRAFT, updatedAt: expectedUpdatedAt }, data: { updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  updateDraftVersionConfig(tx: Prisma.TransactionClient, versionId: string, expectedUpdatedAt: Date, config: Prisma.InputJsonValue) {
    return tx.assessmentDefinitionVersion.updateMany({ where: { id: versionId, status: RevisionStatus.DRAFT, updatedAt: expectedUpdatedAt }, data: { config, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  /** Lifecycle transition guarded on (status=from ∧ token). Sets publishedAt when entering PUBLISHED. */
  transitionVersion(tx: Prisma.TransactionClient, versionId: string, from: RevisionStatus, to: RevisionStatus, expectedUpdatedAt: Date) {
    const data: Prisma.AssessmentDefinitionVersionUpdateManyMutationInput = { status: to, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) };
    if (to === RevisionStatus.PUBLISHED) data.publishedAt = new Date();
    return tx.assessmentDefinitionVersion.updateMany({ where: { id: versionId, status: from, updatedAt: expectedUpdatedAt }, data });
  }
  /** Archive the previous current version (guarded on status only — no client token for it). */
  archiveVersion(tx: Prisma.TransactionClient, versionId: string, from: RevisionStatus, expectedUpdatedAt: Date) {
    return tx.assessmentDefinitionVersion.updateMany({ where: { id: versionId, status: from }, data: { status: RevisionStatus.ARCHIVED, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  /** Bulk flip the status of a version's OWN items (submit-review / return-draft / publish). Never touches other versions' items. */
  setVersionItemsStatus(tx: Prisma.TransactionClient, versionId: string, from: RevisionStatus, to: RevisionStatus) {
    return tx.assessmentItem.updateMany({ where: { status: from, versionItems: { some: { versionId } } }, data: { status: to } });
  }
  /** Non-conditional token advance after an item-token-guarded mutation (serialized by the item's row lock in the same tx). */
  async bumpVersion(tx: Prisma.TransactionClient, versionId: string) {
    const v = await tx.assessmentDefinitionVersion.findUnique({ where: { id: versionId }, select: { updatedAt: true } });
    if (v) await tx.assessmentDefinitionVersion.update({ where: { id: versionId }, data: { updatedAt: nextOptimisticTimestamp(v.updatedAt) } });
  }

  // ── Items ──
  listItems(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentVersionItem.findMany({
      where: { versionId },
      orderBy: [{ orderingOverride: 'asc' }, { item: { createdAt: 'asc' } }],
      select: { orderingOverride: true, difficultyOverride: true, item: { select: { id: true, type: true, payload: true, skillId: true, difficulty: true, status: true, source: true, aiMetadata: true, updatedAt: true } } },
    });
  }
  findItemWithVersions(itemId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentItem.findUnique({
      where: { id: itemId },
      select: {
        id: true, definitionId: true, payload: true, skillId: true, difficulty: true, status: true, updatedAt: true,
        versionItems: { select: { versionId: true, version: { select: { id: true, status: true, definitionId: true, config: true, updatedAt: true } } } },
      },
    });
  }
  createItem(tx: Prisma.TransactionClient, data: { definitionId: string; payload: Prisma.InputJsonValue; skillId: string; difficulty: number; source?: ContentSource; aiMetadata?: Prisma.InputJsonValue }) {
    return tx.assessmentItem.create({
      data: { definitionId: data.definitionId, type: ActivityType.MINI_QUESTION, payload: data.payload, skillId: data.skillId, difficulty: data.difficulty, status: RevisionStatus.DRAFT, source: data.source ?? ContentSource.HUMAN, aiMetadata: data.aiMetadata },
      select: { id: true, updatedAt: true },
    });
  }
  createVersionItem(tx: Prisma.TransactionClient, data: { versionId: string; itemId: string; orderingOverride: number; difficultyOverride?: number | null }) {
    return tx.assessmentVersionItem.create({ data: { versionId: data.versionId, itemId: data.itemId, orderingOverride: data.orderingOverride, difficultyOverride: data.difficultyOverride ?? null } });
  }
  updateItem(tx: Prisma.TransactionClient, itemId: string, expectedUpdatedAt: Date, data: { payload: Prisma.InputJsonValue; skillId: string; difficulty: number }) {
    return tx.assessmentItem.updateMany({ where: { id: itemId, updatedAt: expectedUpdatedAt }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
  deleteVersionItemsForItem(tx: Prisma.TransactionClient, itemId: string) {
    return tx.assessmentVersionItem.deleteMany({ where: { itemId } });
  }
  deleteItem(tx: Prisma.TransactionClient, itemId: string, expectedUpdatedAt: Date) {
    return tx.assessmentItem.deleteMany({ where: { id: itemId, updatedAt: expectedUpdatedAt } });
  }
  setOrdering(tx: Prisma.TransactionClient, versionId: string, itemId: string, ordering: number) {
    return tx.assessmentVersionItem.updateMany({ where: { versionId, itemId }, data: { orderingOverride: ordering } });
  }

  // ── Skills ──
  findSkill(skillId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).skill.findUnique({ where: { id: skillId }, select: { id: true, subjectId: true, status: true } });
  }
  listActiveSubjectSkillIds(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).skill.findMany({ where: { subjectId, status: 'ACTIVE' }, select: { id: true } });
  }
}
