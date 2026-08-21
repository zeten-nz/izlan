import { Injectable, Logger } from '@nestjs/common';
import { AssessmentAttemptPurpose, ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ProfileRepository } from '../profile/profile.repository';
import { LearningIntentRepository } from '../onboarding/learning-intent.repository';
import {
  AssessmentAlreadyCompletedError,
  AssessmentAttemptNotFoundError,
  AssessmentConfigurationInvalidError,
  AssessmentItemNotCurrentError,
  AssessmentNotAvailableError,
  AssessmentResponseConflictError,
  LearningIntentNotFoundError,
  OnboardingIncompleteError,
} from '../common/errors';
import { AssessmentDefinitionRepository } from './repositories/assessment-definition.repository';
import { AssessmentItemRepository } from './repositories/assessment-item.repository';
import { AssessmentAttemptRepository, isUniqueViolation } from './repositories/assessment-attempt.repository';
import { PlacementEngineService } from './engine/placement-engine.service';
import { parsePlacementConfig } from './engine/placement-config';
import {
  PLACEMENT_ENGINE_STATE_SCHEMA_VERSION,
  PLACEMENT_ENGINE_VERSION,
  PLACEMENT_RESULT_SCHEMA_VERSION,
  PlacementConfig,
  PlacementEngineState,
  PlacementResultSummary,
  PoolItem,
  SkillState,
} from './engine/placement-engine.types';
import { ObjectiveScorerService } from './scoring/objective-scorer.service';
import { LearnerFacingItem, isObjectiveFormat, parseItemPayload, projectItemForLearner } from './scoring/item-payload';

interface DefinitionContext {
  definitionId: string;
  versionId: string;
  config: PlacementConfig;
  pool: PoolItem[];
}

/** Learner-facing attempt view (§15/37) — never carries answer keys, difficulty, or engine internals. */
export interface AttemptView {
  attemptId: string;
  status: string;
  engineVersion: string;
  progress: { answered: number; maxItems: number };
  item: LearnerFacingItem | null;
  result: { answered: number; objectiveCorrect: number; coverageComplete: boolean; insufficientSkillIds: string[] } | null;
}

type AttemptRow = NonNullable<Awaited<ReturnType<AssessmentAttemptRepository['findOwnAttempt']>>>;

/**
 * Placement (initial DIAGNOSTIC) assessment engine service (Phase 1.5B / 1.5B-2).
 *
 * BOUNDARY (§40): produces assessment evidence ONLY. It NEVER updates LearnerSkillState / writes
 * SkillMeasurement / creates Roadmap / DailyPlan / XP / IZL, and NEVER calls an AI provider.
 * placement-adaptive-v1 is OBJECTIVE-ONLY (§22): non-objective pools are refused before start.
 */
@Injectable()
export class AssessmentService {
  private readonly logger = new Logger('Assessment');

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileRepository,
    private readonly intents: LearningIntentRepository,
    private readonly definitions: AssessmentDefinitionRepository,
    private readonly items: AssessmentItemRepository,
    private readonly attempts: AssessmentAttemptRepository,
    private readonly engine: PlacementEngineService,
    private readonly scorer: ObjectiveScorerService,
  ) {}

  // ── Availability (§44) ──
  async availability(userId: string, learningIntentId: string): Promise<{ available: boolean }> {
    try {
      const { subjectId } = await this.validateIntent(userId, learningIntentId);
      const existing = await this.attempts.findInProgressInitialDiagnostic(userId, subjectId);
      if (existing) return { available: true }; // resumable
      await this.resolveCurrentDefinition(subjectId);
      return { available: true };
    } catch (e) {
      if (this.isExpectedResolutionError(e)) return { available: false };
      throw e;
    }
  }

  // ── Start / resume (§5/6/7/8) ──
  async start(userId: string, learningIntentId: string): Promise<AttemptView> {
    const { subjectId, trackId } = await this.validateIntent(userId, learningIntentId);

    // Resume authority = (user, subject) IN_PROGRESS INITIAL_DIAGNOSTIC. A moved current pointer must
    // NOT repin an existing attempt to a newer version (§8) — the pinned attempt stays authoritative.
    const existing = await this.attempts.findInProgressInitialDiagnostic(userId, subjectId);
    if (existing) return this.renderAttempt(existing);

    const ctx = await this.resolveCurrentDefinition(subjectId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        let state = this.engine.initialState(ctx.config, ctx.pool);
        const firstItemId = this.engine.pickItem(ctx.config, state, ctx.pool);
        if (!firstItemId) throw new AssessmentConfigurationInvalidError('unusable item pool'); // defensive
        state = this.engine.markPresented(state, firstItemId);

        const attempt = await this.attempts.createAttempt(
          {
            userId,
            definitionId: ctx.definitionId,
            definitionVersionId: ctx.versionId,
            subjectId,
            trackId,
            purpose: AssessmentAttemptPurpose.INITIAL_DIAGNOSTIC,
            engineVersion: PLACEMENT_ENGINE_VERSION,
            engineState: this.serializeState(state),
          },
          tx,
        );
        await this.attempts.createPresentedResponse(attempt.id, firstItemId, 1, tx);
        const item = await this.loadLearnerItem(ctx.versionId, firstItemId, tx);
        return this.viewInProgress(attempt, state, ctx.config.stopping.maxItems, item);
      });
    } catch (e) {
      // Partial-unique race (TD-95): a concurrent start won → resume the single winner (§8/27).
      if (isUniqueViolation(e)) {
        const winner = await this.attempts.findInProgressInitialDiagnostic(userId, subjectId);
        if (winner) return this.renderAttempt(winner);
      }
      throw e;
    }
  }

  // ── Resume / read attempt (§22/37) ──
  async getAttempt(userId: string, attemptId: string): Promise<AttemptView> {
    const attempt = await this.attempts.findOwnAttempt(attemptId, userId);
    if (!attempt) throw new AssessmentAttemptNotFoundError('attempt not found');
    return this.renderAttempt(attempt); // pure read — never advances on reload (§22)
  }

  // ── Submit response (§5/23/24/25/35/47/48) ──
  async submitResponse(userId: string, attemptId: string, itemId: string, answer: Record<string, unknown>): Promise<AttemptView> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await this.attempts.findOwnAttempt(attemptId, userId, tx);
      if (!attempt) throw new AssessmentAttemptNotFoundError('attempt not found');

      const config = await this.loadPinnedConfig(attempt.definitionVersionId, tx);
      const pool = await this.items.listPoolItems(attempt.definitionVersionId, tx);
      let state = this.readEngineState(attempt.engineState);

      const item = await this.items.loadItemInVersion(attempt.definitionVersionId, itemId, tx);
      if (!item) throw new AssessmentConfigurationInvalidError('pool item missing');
      const payload = parseItemPayload(item.payload);
      if (!isObjectiveFormat(payload.format)) throw new AssessmentConfigurationInvalidError('unsupported item format'); // defensive

      // Immutable-response replay/conflict: was this item already answered? (§5)
      const prior = await this.attempts.findSubmittedResponseForItem(attemptId, itemId, tx);
      if (prior) return this.replayOrConflict(attempt, payload, answer, prior.answer, tx);

      if (attempt.status === 'COMPLETED') throw new AssessmentAlreadyCompletedError('attempt already completed');

      const presented = await this.attempts.currentPresentedResponse(attemptId, tx);
      if (!presented) throw new AssessmentAlreadyCompletedError('no item awaiting answer');
      if (presented.itemId !== itemId) throw new AssessmentItemNotCurrentError('item is not the current question');

      const skillId = pool.find((p) => p.itemId === itemId)?.skillId;
      if (!skillId) throw new AssessmentConfigurationInvalidError('pool item missing');
      const scored = this.scorer.score(payload, answer); // 400 on malformed/duplicate/unknown

      // Atomic winner-takes-all transition (§48). count !== 1 ⇒ a concurrent request already advanced.
      const won = await this.attempts.submitPresented(
        presented.id,
        { answer: answer as Prisma.InputJsonValue, isCorrect: scored.isCorrect, deterministicScore: scored.deterministicScore, submittedAt: new Date() },
        tx,
      );
      if (won !== 1) {
        const committed = await this.attempts.findSubmittedResponseForItem(attemptId, itemId, tx);
        return this.replayOrConflict(attempt, payload, answer, committed?.answer ?? null, tx);
      }

      // Advance the engine deterministically — only this item's skill state changes (§18).
      state = this.engine.applyResult(config, state, skillId, scored.isCorrect);
      if (this.engine.isComplete(config, state, pool)) {
        const summary = await this.buildResultSummary(attemptId, state, pool, config, tx);
        await this.attempts.completeAttempt(
          attemptId,
          { engineState: this.serializeState(state), resultSummary: summary as unknown as Prisma.InputJsonValue, completedAt: new Date() },
          tx,
        );
        return this.viewCompleted(attempt, state, summary, config.stopping.maxItems);
      }

      const nextItemId = this.engine.pickItem(config, state, pool)!; // non-null: isComplete was false
      state = this.engine.markPresented(state, nextItemId);
      const nextSeq = (await this.attempts.countResponses(attemptId, tx)) + 1;
      await this.attempts.createPresentedResponse(attemptId, nextItemId, nextSeq, tx);
      await this.attempts.updateEngineState(attemptId, this.serializeState(state), tx);

      const nextItem = await this.loadLearnerItem(attempt.definitionVersionId, nextItemId, tx);
      return this.viewInProgress(attempt, state, config.stopping.maxItems, nextItem);
    });
  }

  // ── Internal ──

  /** Onboarding + own visible intent validation (§6/7). Returns the resolved subject/track. */
  private async validateIntent(userId: string, learningIntentId: string): Promise<{ subjectId: string; trackId: string }> {
    const profile = await this.profiles.getProfile(userId);
    if (!profile?.onboardingCompletedAt) throw new OnboardingIncompleteError('onboarding not completed');

    const intent = await this.intents.findOwnById(learningIntentId, userId);
    if (!intent) throw new LearningIntentNotFoundError('learning intent not found');
    if (!intent.trackId || !intent.track) throw new AssessmentNotAvailableError('intent has no track');
    if (intent.subject.status !== ContainerStatus.PUBLISHED) throw new AssessmentNotAvailableError('subject not available');
    if (intent.track.status !== ContainerStatus.PUBLISHED) throw new AssessmentNotAvailableError('track not available');
    if (intent.track.subjectId !== intent.subjectId) throw new AssessmentNotAvailableError('track/subject mismatch');
    return { subjectId: intent.subjectId, trackId: intent.trackId };
  }

  /**
   * Resolve the current published DIAGNOSTIC definition/version/config/pool for a NEW attempt, and
   * VALIDATE the entire pinned pool up front (§23): every item must be a supported objective format
   * with a positive-integer difficulty. Also enforces coverage feasibility (§19): a pool that cannot
   * possibly satisfy distinctSkills × itemsPerSkill within maxItems is refused before any attempt row.
   */
  private async resolveCurrentDefinition(subjectId: string): Promise<DefinitionContext> {
    const defs = await this.definitions.findPublishedDiagnosticDefinitions(subjectId);
    if (defs.length === 0) throw new AssessmentNotAvailableError('no placement assessment');
    if (defs.length > 1) {
      // Defense-in-depth: partial-unique index (TD-94) prevents this; runtime still refuses to guess (§6).
      this.logger.warn(`multiple published diagnostic definitions for subject ${subjectId}`);
      throw new AssessmentConfigurationInvalidError('ambiguous placement definition');
    }
    const def = defs[0];
    if (!def.currentVersionId) throw new AssessmentNotAvailableError('no published version');
    const version = await this.definitions.findPublishedVersion(def.currentVersionId, def.id);
    if (!version) throw new AssessmentNotAvailableError('no published version');

    const config = parsePlacementConfig(version.config);
    const rows = await this.items.listPoolItemsForValidation(version.id);
    if (rows.length === 0) throw new AssessmentConfigurationInvalidError('empty item pool');

    const pool: PoolItem[] = [];
    for (const r of rows) {
      const payload = parseItemPayload(r.item.payload); // fails safe on malformed payload
      if (!isObjectiveFormat(payload.format)) throw new AssessmentConfigurationInvalidError('unsupported item format'); // objective-only (§22/23)
      const difficulty = r.difficultyOverride ?? r.item.difficulty;
      if (!Number.isInteger(difficulty) || difficulty < 1) throw new AssessmentConfigurationInvalidError('invalid item difficulty'); // positive ordinal (§13)
      // Effective difficulty must lie within the version's profileScale (Phase 1.5C §8) — so mastery
      // normalization is stable and pool-independent.
      if (difficulty < config.profileScale.minDifficulty || difficulty > config.profileScale.maxDifficulty) {
        throw new AssessmentConfigurationInvalidError('item difficulty outside profile scale');
      }
      pool.push({ itemId: r.itemId, skillId: r.item.skillId, difficulty });
    }

    const distinctSkills = this.engine.distinctSkillIds(pool).length;
    if (distinctSkills * config.coverage.itemsPerSkill > config.stopping.maxItems) {
      throw new AssessmentConfigurationInvalidError('coverage exceeds maxItems'); // impossible plan (§19/34)
    }
    return { definitionId: def.id, versionId: version.id, config, pool };
  }

  /** Idempotent replay if the committed answer is canonically equal; otherwise a hard conflict (§5). */
  private async replayOrConflict(
    attempt: AttemptRow,
    payload: ReturnType<typeof parseItemPayload>,
    newAnswer: Record<string, unknown>,
    committedAnswer: Prisma.JsonValue | null,
    tx: Prisma.TransactionClient,
  ): Promise<AttemptView> {
    const fresh = (await this.attempts.findOwnAttempt(attempt.id, attempt.userId, tx))!;
    if (this.scorer.canonicalize(payload, newAnswer) === this.scorer.canonicalize(payload, committedAnswer)) {
      return this.renderAttempt(fresh, tx); // same answer → idempotent
    }
    throw new AssessmentResponseConflictError('response already recorded with a different answer');
  }

  private async renderAttempt(attempt: AttemptRow, tx?: Prisma.TransactionClient): Promise<AttemptView> {
    const config = await this.loadPinnedConfig(attempt.definitionVersionId, tx);
    const state = this.readEngineState(attempt.engineState);
    if (attempt.status === 'COMPLETED') {
      return this.viewCompleted(attempt, state, this.readResultSummary(attempt.resultSummary), config.stopping.maxItems);
    }
    const presented = await this.attempts.currentPresentedResponse(attempt.id, tx);
    const item = presented ? await this.loadLearnerItem(attempt.definitionVersionId, presented.itemId, tx) : null;
    return this.viewInProgress(attempt, state, config.stopping.maxItems, item);
  }

  private async loadPinnedConfig(versionId: string, tx?: Prisma.TransactionClient): Promise<PlacementConfig> {
    const version = await this.definitions.findVersionConfig(versionId, tx);
    if (!version) throw new AssessmentConfigurationInvalidError('pinned version missing');
    return parsePlacementConfig(version.config);
  }

  private async loadLearnerItem(versionId: string, itemId: string, tx?: Prisma.TransactionClient): Promise<LearnerFacingItem> {
    const item = await this.items.loadItemInVersion(versionId, itemId, tx);
    if (!item) throw new AssessmentConfigurationInvalidError('pool item missing');
    return projectItemForLearner(item.id, item.type, parseItemPayload(item.payload));
  }

  private async buildResultSummary(
    attemptId: string,
    state: PlacementEngineState,
    pool: PoolItem[],
    config: PlacementConfig,
    tx: Prisma.TransactionClient,
  ): Promise<PlacementResultSummary> {
    const rows = await this.attempts.listSubmittedForSummary(attemptId, tx);
    let objectiveCorrect = 0;
    let objectiveScored = 0;
    const skills = new Set<string>();
    for (const r of rows) {
      skills.add(r.item.skillId);
      if (r.deterministicScore !== null) objectiveScored += 1;
      if (r.isCorrect === true) objectiveCorrect += 1;
    }
    const cov = this.engine.coverage(config, state, pool);
    return {
      schemaVersion: PLACEMENT_RESULT_SCHEMA_VERSION,
      engineVersion: PLACEMENT_ENGINE_VERSION,
      answeredCount: state.answeredCount,
      objectiveCorrect,
      objectiveScored,
      coverageSkillIds: [...skills].sort((a, b) => (a < b ? -1 : 1)),
      coverageComplete: cov.complete,
      insufficientSkillIds: cov.insufficientSkillIds,
    };
  }

  private serializeState(state: PlacementEngineState): Prisma.InputJsonValue {
    return state as unknown as Prisma.InputJsonValue;
  }

  private readEngineState(raw: Prisma.JsonValue | null): PlacementEngineState {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new AssessmentConfigurationInvalidError('engine state corrupt');
    const s = raw as Record<string, unknown>;
    if (s.schemaVersion !== PLACEMENT_ENGINE_STATE_SCHEMA_VERSION) throw new AssessmentConfigurationInvalidError('engine state version');
    if (!Array.isArray(s.presentedItemIds) || !s.presentedItemIds.every((x) => typeof x === 'string')) throw new AssessmentConfigurationInvalidError('engine state shape');
    if (typeof s.answeredCount !== 'number') throw new AssessmentConfigurationInvalidError('engine state shape');
    if (s.skills === null || typeof s.skills !== 'object' || Array.isArray(s.skills)) throw new AssessmentConfigurationInvalidError('engine state shape');
    const skills: Record<string, SkillState> = {};
    for (const [sid, v] of Object.entries(s.skills as Record<string, unknown>)) {
      if (v === null || typeof v !== 'object') throw new AssessmentConfigurationInvalidError('engine state shape');
      const sv = v as Record<string, unknown>;
      if (typeof sv.targetDifficulty !== 'number' || typeof sv.answeredCount !== 'number') throw new AssessmentConfigurationInvalidError('engine state shape');
      skills[sid] = { targetDifficulty: sv.targetDifficulty, answeredCount: sv.answeredCount };
    }
    return {
      schemaVersion: PLACEMENT_ENGINE_STATE_SCHEMA_VERSION,
      engineVersion: PLACEMENT_ENGINE_VERSION,
      presentedItemIds: s.presentedItemIds as string[],
      answeredCount: s.answeredCount,
      skills,
    };
  }

  private readResultSummary(raw: Prisma.JsonValue | null): PlacementResultSummary {
    const s = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
    return {
      schemaVersion: PLACEMENT_RESULT_SCHEMA_VERSION,
      engineVersion: PLACEMENT_ENGINE_VERSION,
      answeredCount: num(s.answeredCount),
      objectiveCorrect: num(s.objectiveCorrect),
      objectiveScored: num(s.objectiveScored),
      coverageSkillIds: arr(s.coverageSkillIds),
      coverageComplete: s.coverageComplete === true,
      insufficientSkillIds: arr(s.insufficientSkillIds),
    };
  }

  private viewInProgress(attempt: AttemptRow, state: PlacementEngineState, maxItems: number, item: LearnerFacingItem | null): AttemptView {
    return {
      attemptId: attempt.id,
      status: attempt.status,
      engineVersion: attempt.engineVersion ?? PLACEMENT_ENGINE_VERSION,
      progress: { answered: state.answeredCount, maxItems },
      item,
      result: null,
    };
  }

  private viewCompleted(attempt: AttemptRow, state: PlacementEngineState, summary: PlacementResultSummary, maxItems: number): AttemptView {
    return {
      attemptId: attempt.id,
      status: 'COMPLETED',
      engineVersion: attempt.engineVersion ?? PLACEMENT_ENGINE_VERSION,
      progress: { answered: state.answeredCount, maxItems },
      item: null,
      result: {
        answered: summary.answeredCount,
        objectiveCorrect: summary.objectiveCorrect,
        coverageComplete: summary.coverageComplete,
        insufficientSkillIds: summary.insufficientSkillIds,
      },
    };
  }

  private isExpectedResolutionError(e: unknown): boolean {
    return (
      e instanceof OnboardingIncompleteError ||
      e instanceof LearningIntentNotFoundError ||
      e instanceof AssessmentNotAvailableError ||
      e instanceof AssessmentConfigurationInvalidError
    );
  }
}
