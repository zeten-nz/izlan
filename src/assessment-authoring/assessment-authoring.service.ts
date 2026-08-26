import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SubjectScopeService } from '../content-authoring/subject-scope.service';
import { ContentAuditRepository } from '../content-authoring/content-audit.repository';
import {
  AssessmentEditableVersionExistsError,
  AssessmentInvalidItemError,
  AssessmentItemImmutableError,
  AssessmentNotDraftError,
  AssessmentNotInReviewError,
  AssessmentNotReadyError,
  AssessmentPublicationStateInvalidError,
  AssessmentSkillInvalidError,
  ContentEditConflictError,
  ContentNotFoundError,
} from '../common/errors';
import { parseItemPayload, PLACEMENT_ITEM_SCHEMA_VERSION } from '../assessment/scoring/item-payload';
import { type PlacementConfig } from '../assessment/engine/placement-engine.types';
import { AssessmentAuthoringRepository } from './assessment-authoring.repository';
import { AssessmentReadinessService } from './assessment-readiness.service';
import { ASSESSMENT_AUDIT, ASSESSMENT_TARGET } from './assessment-authoring.constants';
import { applyEditableConfig, DEFAULT_PLACEMENT_CONFIG, parseAuthoringConfig } from './assessment-config';
import { toDefinitionView, toLearnerPreviewItem, toStaffConfig, toStaffItem, toVersionSummary } from './assessment-authoring.presenter';
import {
  CreateItemDto,
  CreateVersionDto,
  DeleteItemDto,
  EnsureDefinitionDto,
  PublishVersionDto,
  ReorderItemsDto,
  ReturnDraftDto,
  SubmitReviewDto,
  UpdateDefinitionDto,
  UpdateItemDto,
  UpdateVersionConfigDto,
} from './dto/assessment-authoring.dto';

const sameToken = (expected: string, current: Date): boolean => new Date(expected).getTime() === current.getTime();
const DEFAULT_DIAGNOSTIC_TITLE = 'Placement diagnostic';

/**
 * Assessment authoring service (V1 — diagnostic/placement). Mirrors content-authoring: permission (guard) + SubjectAssignment
 * (SubjectScopeService) + DRAFT-only mutation + OCC + StaffAudit in the SAME transaction. Item ownership is version-scoped:
 * a DRAFT version owns fresh AssessmentItem rows; cloning copies the current published version's items into NEW rows; an
 * item referenced by a REVIEW/PUBLISHED/ARCHIVED version is immutable. The learner runtime is never mutated here.
 */
@Injectable()
export class AssessmentAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AssessmentAuthoringRepository,
    private readonly scope: SubjectScopeService,
    private readonly audit: ContentAuditRepository,
    private readonly readiness: AssessmentReadinessService,
  ) {}

  // ── Reads (assessment.author + scope) ──
  async getSubjectAssessments(userId: string, subjectId: string) {
    await this.scope.requireScope(userId, subjectId);
    const def = await this.repo.findDiagnosticBySubject(subjectId);
    if (!def) return { definition: null, versions: [] };
    return { definition: toDefinitionView(def), versions: await this.versionSummaries(def.id, def.currentVersionId) };
  }

  async getDefinition(userId: string, definitionId: string) {
    const def = await this.repo.findDefinition(definitionId);
    if (!def) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, def.subjectId);
    return { definition: toDefinitionView(def), versions: await this.versionSummaries(def.id, def.currentVersionId) };
  }

  async getVersion(userId: string, versionId: string) {
    const { def } = await this.resolveVersion(userId, versionId);
    return this.versionDetail(undefined, def, versionId);
  }

  async getReadiness(userId: string, versionId: string) {
    await this.resolveVersion(userId, versionId);
    return (await this.readiness.evaluate(versionId))!;
  }

  async preview(userId: string, versionId: string) {
    const { version } = await this.resolveVersion(userId, versionId);
    const rows = await this.repo.listItems(versionId);
    // learner-safe projection (answerKey/skillId/difficulty stripped) — the exact shared runtime authority.
    return { versionId: version.id, items: rows.map((r) => toLearnerPreviewItem({ id: r.item.id, type: r.item.type, payload: r.item.payload })) };
  }

  // ── Definition create / edit (assessment.author + scope) ──
  async ensureDefinition(userId: string, subjectId: string, dto: EnsureDefinitionDto) {
    await this.scope.requireScope(userId, subjectId);
    const existing = await this.repo.findDiagnosticBySubject(subjectId);
    if (existing) return toDefinitionView(existing); // idempotent — never a second DIAGNOSTIC per Subject
    return await this.prisma.$transaction(async (tx) => {
      const locked = await this.repo.lockSubject(tx, subjectId); // serialize concurrent create on the Subject row
      if (!locked) throw new ContentNotFoundError('not found');
      const again = await this.repo.findDiagnosticBySubject(subjectId, tx); // re-read after the lock (no race-y create)
      if (again) return toDefinitionView(again);
      const def = await this.repo.createDefinition(tx, { subjectId, title: dto.title ?? DEFAULT_DIAGNOSTIC_TITLE, description: dto.description ?? null, createdBy: userId });
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.DEFINITION_CREATE, targetType: ASSESSMENT_TARGET.DEFINITION, targetId: def.id, metadata: { subjectId, purposeScope: 'DIAGNOSTIC' } });
      return toDefinitionView(def);
    });
  }

  async updateDefinition(userId: string, definitionId: string, dto: UpdateDefinitionDto) {
    return await this.prisma.$transaction(async (tx) => {
      const def = await this.repo.findDefinition(definitionId, tx);
      if (!def) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, def.subjectId, tx);
      if (!sameToken(dto.expectedUpdatedAt, def.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const data: { title?: string; description?: string } = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.description !== undefined) data.description = dto.description;
      if (Object.keys(data).length > 0) {
        const res = await this.repo.updateDefinition(tx, definitionId, def.updatedAt, data);
        if (res.count === 0) throw new ContentEditConflictError('edit conflict');
        await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.DEFINITION_UPDATE, targetType: ASSESSMENT_TARGET.DEFINITION, targetId: definitionId, metadata: { fields: Object.keys(data) } });
      }
      return toDefinitionView((await this.repo.findDefinition(definitionId, tx))!);
    });
  }

  // ── Version create (blank | clone_current) ──
  async createVersion(userId: string, definitionId: string, dto: CreateVersionDto) {
    return await this.prisma.$transaction(async (tx) => {
      const def = await this.repo.findDefinition(definitionId, tx);
      if (!def) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, def.subjectId, tx);
      await this.repo.lockDefinition(tx, definitionId);
      if (await this.repo.findEditableVersion(definitionId, tx)) throw new AssessmentEditableVersionExistsError('editable version exists'); // decision G
      const versionNo = (await this.repo.maxVersionNo(definitionId, tx)) + 1;

      if (dto.mode === 'blank') {
        const version = await this.repo.createVersion(tx, { definitionId, versionNo, config: DEFAULT_PLACEMENT_CONFIG as unknown as Prisma.InputJsonValue, createdBy: userId });
        await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_CREATE, targetType: ASSESSMENT_TARGET.VERSION, targetId: version.id, metadata: { definitionId, versionNo, mode: 'blank' } });
        return this.versionDetail(tx, def, version.id);
      }

      // clone_current — copy the published current version's config + items into NEW rows (never reuse old ids).
      if (!def.currentVersionId) throw new AssessmentPublicationStateInvalidError('no current version to clone');
      const current = await this.repo.findVersion(def.currentVersionId, tx);
      if (!current) throw new AssessmentPublicationStateInvalidError('current version missing');
      const config = parseAuthoringConfig(current.config); // preserve the current (valid) config
      const version = await this.repo.createVersion(tx, { definitionId, versionNo, config: config as unknown as Prisma.InputJsonValue, createdBy: userId });
      const sourceItems = await this.repo.listItems(def.currentVersionId, tx);
      let ordering = 0;
      for (const row of sourceItems) {
        const src = row.item;
        const newItem = await this.repo.createItem(tx, {
          definitionId,
          payload: src.payload as Prisma.InputJsonValue,
          skillId: src.skillId,
          difficulty: src.difficulty,
          source: src.source,
          aiMetadata: src.aiMetadata === null ? undefined : (src.aiMetadata as Prisma.InputJsonValue),
        });
        await this.repo.createVersionItem(tx, { versionId: version.id, itemId: newItem.id, orderingOverride: ordering, difficultyOverride: row.difficultyOverride });
        ordering++;
      }
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_CREATE, targetType: ASSESSMENT_TARGET.VERSION, targetId: version.id, metadata: { definitionId, versionNo, mode: 'clone_current', clonedFromVersionId: def.currentVersionId, itemCount: sourceItems.length } });
      return this.versionDetail(tx, def, version.id);
    });
  }

  // ── Config edit (DRAFT only, OCC on Version token) ──
  async updateConfig(userId: string, versionId: string, dto: UpdateVersionConfigDto) {
    return await this.prisma.$transaction(async (tx) => {
      const { version, def } = await this.resolveVersion(userId, versionId, tx);
      if (version.status !== RevisionStatus.DRAFT) throw new AssessmentNotDraftError('not draft');
      const next = applyEditableConfig(parseAuthoringConfig(version.config), { itemsPerSkill: dto.itemsPerSkill, maxItems: dto.maxItems, startDifficulty: dto.startDifficulty });
      const res = await this.repo.updateDraftVersionConfig(tx, versionId, new Date(dto.expectedVersionUpdatedAt), next as unknown as Prisma.InputJsonValue);
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_UPDATE, targetType: ASSESSMENT_TARGET.VERSION, targetId: versionId, metadata: { fields: ['config'] } });
      return this.versionDetail(tx, def, versionId);
    });
  }

  // ── Item create (DRAFT version, OCC on Version token) ──
  async createItem(userId: string, versionId: string, dto: CreateItemDto) {
    return await this.prisma.$transaction(async (tx) => {
      const { version, def } = await this.resolveVersion(userId, versionId, tx);
      if (version.status !== RevisionStatus.DRAFT) throw new AssessmentNotDraftError('not draft');
      const config = parseAuthoringConfig(version.config);
      await this.requireActiveSubjectSkill(dto.skillId, def.subjectId, tx);
      this.requireDifficultyInScale(dto.difficulty, config);
      const payload = this.buildItemPayload(dto);
      const touched = await this.repo.touchDraftVersion(tx, versionId, new Date(dto.expectedVersionUpdatedAt));
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      const ordering = await this.repo.countVersionItems(versionId, tx); // append at end
      const item = await this.repo.createItem(tx, { definitionId: def.id, payload, skillId: dto.skillId, difficulty: dto.difficulty });
      await this.repo.createVersionItem(tx, { versionId, itemId: item.id, orderingOverride: ordering });
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.ITEM_CREATE, targetType: ASSESSMENT_TARGET.ITEM, targetId: item.id, metadata: { versionId, skillId: dto.skillId } });
      return this.versionDetail(tx, def, versionId);
    });
  }

  // ── Item update (owning version must be DRAFT, OCC on Item token) ──
  async updateItem(userId: string, itemId: string, dto: UpdateItemDto) {
    return await this.prisma.$transaction(async (tx) => {
      const ctx = await this.resolveEditableItem(userId, itemId, tx);
      const config = parseAuthoringConfig(ctx.version.config);
      await this.requireActiveSubjectSkill(dto.skillId, ctx.subjectId, tx);
      this.requireDifficultyInScale(dto.difficulty, config);
      const payload = this.buildItemPayload(dto);
      const res = await this.repo.updateItem(tx, itemId, new Date(dto.expectedItemUpdatedAt), { payload, skillId: dto.skillId, difficulty: dto.difficulty });
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.repo.bumpVersion(tx, ctx.version.id); // advance the aggregate token so version-level readers refresh
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.ITEM_UPDATE, targetType: ASSESSMENT_TARGET.ITEM, targetId: itemId, metadata: { versionId: ctx.version.id, skillId: dto.skillId } });
      return this.versionDetail(tx, ctx.def, ctx.version.id);
    });
  }

  // ── Item delete (DRAFT version only, OCC on Item token) ──
  async deleteItem(userId: string, itemId: string, dto: DeleteItemDto) {
    return await this.prisma.$transaction(async (tx) => {
      const ctx = await this.resolveEditableItem(userId, itemId, tx);
      await this.repo.deleteVersionItemsForItem(tx, itemId); // FK Restrict → remove the link first (rolls back if the item delete fails)
      const del = await this.repo.deleteItem(tx, itemId, new Date(dto.expectedItemUpdatedAt));
      if (del.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.repo.bumpVersion(tx, ctx.version.id);
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.ITEM_DELETE, targetType: ASSESSMENT_TARGET.ITEM, targetId: itemId, metadata: { versionId: ctx.version.id, skillId: ctx.item.skillId } });
      return this.versionDetail(tx, ctx.def, ctx.version.id);
    });
  }

  // ── Reorder (DRAFT version, OCC on Version token — VersionItem has no token) ──
  async reorder(userId: string, versionId: string, dto: ReorderItemsDto) {
    return await this.prisma.$transaction(async (tx) => {
      const { version, def } = await this.resolveVersion(userId, versionId, tx);
      if (version.status !== RevisionStatus.DRAFT) throw new AssessmentNotDraftError('not draft');
      const currentIds = (await this.repo.listItems(versionId, tx)).map((r) => r.item.id);
      this.assertExactReorderSet(dto.orderedItemIds, currentIds);
      const touched = await this.repo.touchDraftVersion(tx, versionId, new Date(dto.expectedVersionUpdatedAt));
      if (touched.count === 0) throw new ContentEditConflictError('edit conflict');
      for (let i = 0; i < dto.orderedItemIds.length; i++) await this.repo.setOrdering(tx, versionId, dto.orderedItemIds[i], i);
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_REORDER_ITEMS, targetType: ASSESSMENT_TARGET.VERSION, targetId: versionId, metadata: { versionId, itemCount: dto.orderedItemIds.length } });
      return this.versionDetail(tx, def, versionId);
    });
  }

  // ── DRAFT → REVIEW (assessment.author + scope) ──
  async submitReview(userId: string, versionId: string, dto: SubmitReviewDto) {
    return await this.prisma.$transaction(async (tx) => {
      const { version, def } = await this.resolveVersion(userId, versionId, tx);
      if (version.status !== RevisionStatus.DRAFT) throw new AssessmentNotDraftError('not draft');
      const report = await this.readiness.evaluate(versionId, tx);
      if (!report || !report.publishReady) throw new AssessmentNotReadyError('not ready');
      const res = await this.repo.transitionVersion(tx, versionId, RevisionStatus.DRAFT, RevisionStatus.REVIEW, new Date(dto.expectedVersionUpdatedAt));
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      // A non-current version's items are NEVER read by the learner runtime (it reads currentVersionId only), so flipping
      // this version's own items DRAFT→REVIEW is safe.
      await this.repo.setVersionItemsStatus(tx, versionId, RevisionStatus.DRAFT, RevisionStatus.REVIEW);
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_SUBMIT_REVIEW, targetType: ASSESSMENT_TARGET.VERSION, targetId: versionId, metadata: { definitionId: def.id, versionNo: version.versionNo } });
      return this.versionDetail(tx, def, versionId);
    });
  }

  // ── REVIEW → DRAFT (assessment.publish + scope), reason mandatory ──
  async returnDraft(userId: string, versionId: string, dto: ReturnDraftDto) {
    return await this.prisma.$transaction(async (tx) => {
      const { version, def } = await this.resolveVersion(userId, versionId, tx);
      if (version.status !== RevisionStatus.REVIEW) throw new AssessmentNotInReviewError('not in review');
      const res = await this.repo.transitionVersion(tx, versionId, RevisionStatus.REVIEW, RevisionStatus.DRAFT, new Date(dto.expectedVersionUpdatedAt));
      if (res.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.repo.setVersionItemsStatus(tx, versionId, RevisionStatus.REVIEW, RevisionStatus.DRAFT);
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_RETURN_DRAFT, targetType: ASSESSMENT_TARGET.VERSION, targetId: versionId, reason: dto.reason, metadata: { definitionId: def.id, versionNo: version.versionNo } });
      return this.versionDetail(tx, def, versionId);
    });
  }

  // ── REVIEW → PUBLISHED (assessment.publish + scope) — atomic currentVersion switch, Definition-row serialized ──
  async publish(userId: string, versionId: string, dto: PublishVersionDto) {
    return await this.prisma.$transaction(async (tx) => {
      const init = await this.repo.findVersion(versionId, tx);
      if (!init) throw new ContentNotFoundError('not found');
      const defInit = await this.repo.findDefinition(init.definitionId, tx);
      if (!defInit) throw new ContentNotFoundError('not found');
      await this.scope.requireScope(userId, defInit.subjectId, tx);
      await this.repo.lockDefinition(tx, defInit.id); // serialize publish for this Definition
      // authoritative re-read after the lock
      const version = (await this.repo.findVersion(versionId, tx))!;
      const def = (await this.repo.findDefinition(defInit.id, tx))!;
      if (version.status !== RevisionStatus.REVIEW) throw new AssessmentNotInReviewError('not in review'); // no direct DRAFT→PUBLISHED
      if (!sameToken(dto.expectedVersionUpdatedAt, version.updatedAt)) throw new ContentEditConflictError('edit conflict');
      const report = await this.readiness.evaluate(versionId, tx);
      if (!report || !report.publishReady) throw new AssessmentNotReadyError('not ready');

      // Replace the previous current version (if any): version row PUBLISHED → ARCHIVED. Its ITEMS are intentionally
      // LEFT PUBLISHED — in-progress attempts pinned to that version read those item payloads by id (§21.8).
      const previousVersionId = def.currentVersionId;
      if (previousVersionId && previousVersionId !== versionId) {
        const prev = await this.repo.findVersion(previousVersionId, tx);
        if (!prev || prev.definitionId !== def.id) throw new AssessmentPublicationStateInvalidError('incoherent pointer');
        if (prev.status === RevisionStatus.PUBLISHED) {
          const archived = await this.repo.archiveVersion(tx, previousVersionId, RevisionStatus.PUBLISHED, prev.updatedAt);
          if (archived.count === 0) throw new AssessmentPublicationStateInvalidError('archive failed');
        }
      }

      const pub = await this.repo.transitionVersion(tx, versionId, RevisionStatus.REVIEW, RevisionStatus.PUBLISHED, version.updatedAt);
      if (pub.count === 0) throw new ContentEditConflictError('edit conflict');
      await this.repo.setVersionItemsStatus(tx, versionId, RevisionStatus.REVIEW, RevisionStatus.PUBLISHED);
      await this.repo.setCurrentVersion(tx, def.id, versionId);
      if (def.status === ContainerStatus.DRAFT) await this.repo.setDefinitionStatus(tx, def.id, ContainerStatus.DRAFT, ContainerStatus.PUBLISHED);
      await this.audit.write(tx, { actorUserId: userId, actionCode: ASSESSMENT_AUDIT.VERSION_PUBLISH, targetType: ASSESSMENT_TARGET.VERSION, targetId: versionId, metadata: { definitionId: def.id, versionNo: version.versionNo, previousVersionId, firstPublication: previousVersionId === null } });
      return this.versionDetail(tx, (await this.repo.findDefinition(def.id, tx))!, versionId);
    });
  }

  // ── internals ──
  private async versionSummaries(definitionId: string, currentVersionId: string | null) {
    const versions = await this.repo.listVersions(definitionId);
    const out = [];
    for (const v of versions) out.push(toVersionSummary(v, currentVersionId, await this.repo.countVersionItems(v.id)));
    return out;
  }

  private async resolveVersion(userId: string, versionId: string, tx?: Prisma.TransactionClient) {
    const version = await this.repo.findVersion(versionId, tx);
    if (!version) throw new ContentNotFoundError('not found');
    const def = await this.repo.findDefinition(version.definitionId, tx);
    if (!def) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, def.subjectId, tx); // IDOR-safe: out-of-scope → not found
    return { version, def };
  }

  /** Resolve an item that is editable: it must belong to EXACTLY ONE DRAFT version, in the actor's scope. */
  private async resolveEditableItem(userId: string, itemId: string, tx: Prisma.TransactionClient) {
    const item = await this.repo.findItemWithVersions(itemId, tx);
    if (!item) throw new ContentNotFoundError('not found');
    if (item.versionItems.length !== 1) throw new AssessmentItemImmutableError('item is referenced by multiple versions'); // never silently mutate shared data
    const version = item.versionItems[0].version;
    const def = await this.repo.findDefinition(version.definitionId, tx);
    if (!def) throw new ContentNotFoundError('not found');
    await this.scope.requireScope(userId, def.subjectId, tx);
    if (version.status !== RevisionStatus.DRAFT) throw new AssessmentItemImmutableError('owning version is not draft'); // association state is authoritative, not item.status
    return { item, version, def, subjectId: def.subjectId };
  }

  private async versionDetail(tx: Prisma.TransactionClient | undefined, def: { id: string; currentVersionId: string | null }, versionId: string) {
    const version = (await this.repo.findVersion(versionId, tx))!;
    const rows = await this.repo.listItems(versionId, tx);
    const items = rows.map((r, i) => toStaffItem({ id: r.item.id, payload: r.item.payload, skillId: r.item.skillId, difficulty: r.item.difficulty, difficultyOverride: r.difficultyOverride, updatedAt: r.item.updatedAt, ordering: i }));
    return {
      version: { id: version.id, versionNo: version.versionNo, status: version.status, isCurrent: def.currentVersionId === version.id, publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null, updatedAt: version.updatedAt.toISOString() },
      config: toStaffConfig(parseAuthoringConfig(version.config)),
      items,
    };
  }

  private async requireActiveSubjectSkill(skillId: string, subjectId: string, tx: Prisma.TransactionClient) {
    const skill = await this.repo.findSkill(skillId, tx);
    if (!skill || skill.subjectId !== subjectId || skill.status !== 'ACTIVE') throw new AssessmentSkillInvalidError('invalid skill');
  }

  private requireDifficultyInScale(difficulty: number, config: PlacementConfig) {
    if (difficulty < config.profileScale.minDifficulty || difficulty > config.profileScale.maxDifficulty) throw new AssessmentInvalidItemError('difficulty out of scale');
  }

  private buildItemPayload(input: { format: string; prompt: string; options: { id: string; text: string }[]; correctOptionIds: string[] }): Prisma.InputJsonValue {
    const raw = { schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: input.format, prompt: input.prompt, options: input.options.map((o) => ({ id: o.id, text: o.text })), answerKey: { correctOptionIds: input.correctOptionIds } };
    try {
      return parseItemPayload(raw) as unknown as Prisma.InputJsonValue; // normalized + fully validated (options/answerKey rules)
    } catch {
      throw new AssessmentInvalidItemError('invalid item');
    }
  }

  private assertExactReorderSet(orderedItemIds: string[], currentIds: string[]) {
    if (orderedItemIds.length !== currentIds.length) throw new AssessmentInvalidItemError('reorder set mismatch');
    const current = new Set(currentIds);
    const seen = new Set<string>();
    for (const id of orderedItemIds) {
      if (seen.has(id)) throw new AssessmentInvalidItemError('duplicate id in reorder');
      if (!current.has(id)) throw new AssessmentInvalidItemError('foreign id in reorder');
      seen.add(id);
    }
  }
}
