import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Clock } from '../common/clock';
import { ResourceNotFoundError } from '../common/errors';
import { LearnerSignalsRepository } from './learner-signals.repository';
import {
  REPEATED_MISTAKE_EVIDENCE_SCHEMA,
  REPEATED_MISTAKE_SIGNAL_TYPE,
  collapseLatestPerActivity,
  detectRepeatedMistake,
} from './repeated-mistake.detector';
import { WEAK_SKILL_EVIDENCE_SCHEMA, WEAK_SKILL_SIGNAL_TYPE, detectWeakSkill } from './weak-skill-signal.policy';
import { REVIEW_DUE_EVIDENCE_SCHEMA, REVIEW_DUE_SIGNAL_TYPE, parseReviewBasis, reviewActivation, reviewResolves } from './review-due-signal.policy';

const STATE_SIGNAL_TYPES = [WEAK_SKILL_SIGNAL_TYPE, REVIEW_DUE_SIGNAL_TYPE];
type StateRow = { masteryScoreBp: number; confidenceBp: number | null; evidenceCount: number; lastMeasurementAt: Date | null } | null;

export interface SignalView {
  id: string;
  type: string;
  status: string;
  skill: { id: string; name: string } | null;
  createdAt: string;
}

/**
 * Learner Signals (Phase 1.8B). Repeated-mistake episodes are ADVISORY state derived from objective lesson
 * ActivityAttempt evidence. The ONLY writer of LearnerSignal. Never mutates ActivityAttempt / SkillMeasurement
 * / LearnerSkillState / Roadmap / DailyPlan / rewards / notifications / AI (TD-118, §37-42/66).
 */
@Injectable()
export class LearnerSignalsService {
  private readonly logger = new Logger('LearnerSignals');

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LearnerSignalsRepository,
    private readonly clock: Clock,
  ) {}

  /** Downstream advisory hook after a persisted ActivityAttempt (§27). Failures never roll back the attempt. */
  async evaluateForActivity(userId: string, activityId: string): Promise<void> {
    const skillIds = await this.repo.attributedSkillIdsForActivity(activityId);
    if (skillIds.length) await this.evaluateSkills(userId, skillIds);
  }

  /** Evaluate a set of skills — each under its own per-(user,skill) lock/transaction (§24/26). */
  async evaluateSkills(userId: string, skillIds: string[]): Promise<void> {
    for (const skillId of [...new Set(skillIds)].sort()) await this.evaluateSkill(userId, skillId);
  }

  private async evaluateSkill(userId: string, skillId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.advisoryLock(tx, userId, skillId); // serialize; then load FRESH inside the lock (§25)
      const subjectId = await this.repo.skillSubjectId(tx, skillId);
      if (!subjectId) return; // skill missing → nothing to evaluate
      const attempts = await this.repo.eligibleAttemptsForSkill(tx, userId, skillId, subjectId);
      const outcomes = collapseLatestPerActivity(attempts); // latest per distinct Activity (§10)
      const active = await this.repo.findActiveSignal(tx, userId, skillId, REPEATED_MISTAKE_SIGNAL_TYPE);
      const decision = detectRepeatedMistake(outcomes, active !== null);

      if (decision.action === 'ACTIVATE') {
        await this.tryCreate(tx, {
          userId,
          subjectId,
          skillId,
          type: REPEATED_MISTAKE_SIGNAL_TYPE,
          evidenceRefs: { schemaVersion: REPEATED_MISTAKE_EVIDENCE_SCHEMA, triggerActivityIds: decision.triggerActivityIds, triggerAttemptIds: decision.triggerAttemptIds },
        });
      } else if (decision.action === 'RESOLVE' && active) {
        await this.repo.resolveSignal(tx, active.id, this.clock.now()); // conditional, idempotent (§20/61)
      }
    });
  }

  /**
   * Evaluate the state-derived signals (WEAK_SKILL + REVIEW_DUE) for one skill, under one signal lock (§25).
   * Reads current LearnerSkillState only (§4/14) — never raw attempts/measurements. Writes only LearnerSignal.
   */
  async evaluateStateSignals(userId: string, skillId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.advisoryLock(tx, userId, skillId);
      const subjectId = await this.repo.skillSubjectId(tx, skillId);
      if (!subjectId) return;
      const state = (await this.repo.currentState(tx, userId, skillId)) as StateRow;
      const now = this.clock.now();
      await this.applyWeakSkill(tx, userId, subjectId, skillId, state, now);
      await this.applyReviewDue(tx, userId, subjectId, skillId, state, now);
    });
  }

  /** Evaluate WEAK_SKILL + REVIEW_DUE for a set of skills (each under its own lock, §28). */
  async evaluateStateSkills(userId: string, skillIds: string[]): Promise<void> {
    for (const skillId of [...new Set(skillIds)].sort()) await this.evaluateStateSignals(userId, skillId);
  }

  private async applyWeakSkill(tx: Prisma.TransactionClient, userId: string, subjectId: string, skillId: string, state: StateRow, now: Date): Promise<void> {
    const active = await this.repo.findActiveSignal(tx, userId, skillId, WEAK_SKILL_SIGNAL_TYPE);
    const input = state ? { masteryScoreBp: state.masteryScoreBp, confidenceBp: state.confidenceBp ?? 0, evidenceCount: state.evidenceCount } : null;
    const decision = detectWeakSkill(input, active !== null);
    if (decision === 'ACTIVATE' && state) {
      await this.tryCreate(tx, {
        userId,
        subjectId,
        skillId,
        type: WEAK_SKILL_SIGNAL_TYPE,
        evidenceRefs: { schemaVersion: WEAK_SKILL_EVIDENCE_SCHEMA, masteryScoreBp: state.masteryScoreBp, confidenceBp: state.confidenceBp ?? 0, evidenceCount: state.evidenceCount, lastMeasurementAt: state.lastMeasurementAt ? state.lastMeasurementAt.toISOString() : null },
      });
    } else if (decision === 'RESOLVE' && active) {
      await this.repo.resolveSignal(tx, active.id, now);
    }
  }

  private async applyReviewDue(tx: Prisma.TransactionClient, userId: string, subjectId: string, skillId: string, state: StateRow, now: Date): Promise<void> {
    const active = await this.repo.findActiveSignal(tx, userId, skillId, REVIEW_DUE_SIGNAL_TYPE);
    let stillActive = active !== null;
    if (active) {
      const basis = parseReviewBasis(active.evidenceRefs);
      if (basis && reviewResolves(state?.lastMeasurementAt ?? null, basis)) {
        await this.repo.resolveSignal(tx, active.id, now); // newer evidence → resolve (§20/52)
        stillActive = false;
      }
    }
    if (!stillActive) {
      // §21: after resolving, only re-activate if the new state is actually due again now (normally future).
      const input = state ? { masteryScoreBp: state.masteryScoreBp, confidenceBp: state.confidenceBp ?? 0, evidenceCount: state.evidenceCount, lastMeasurementAt: state.lastMeasurementAt } : null;
      const activation = reviewActivation(input, now);
      if (activation) {
        await this.tryCreate(tx, {
          userId,
          subjectId,
          skillId,
          type: REVIEW_DUE_SIGNAL_TYPE,
          evidenceRefs: {
            schemaVersion: REVIEW_DUE_EVIDENCE_SCHEMA,
            basisLastMeasurementAt: activation.basisLastMeasurementAt.toISOString(),
            masteryScoreBp: activation.masteryScoreBp,
            confidenceBp: activation.confidenceBp,
            evidenceCount: activation.evidenceCount,
            intervalDays: activation.intervalDays,
            dueAt: activation.dueAt.toISOString(),
          },
        });
      }
    }
  }

  /** Create an ACTIVE signal; the one-active partial unique is the concurrency authority (P2002 → already active). */
  private async tryCreate(tx: Prisma.TransactionClient, data: { userId: string; subjectId: string; skillId: string; type: string; evidenceRefs: Prisma.InputJsonValue }): Promise<void> {
    try {
      await this.repo.createSignal(tx, data);
    } catch (e) {
      if (!this.repo.isUniqueViolation(e)) throw e; // §58/59 concurrent create → one ACTIVE
    }
  }

  /** Repair/reconcile every relevant skill's signal state in a Subject (§27/28/30/31). Deterministic, idempotent;
   *  the time-based path (REVIEW_DUE eligibility) is evaluated here via Clock.now() — GET stays read-only (§32/33).
   *  Never creates attempts / SkillMeasurement / LearnerSkillState / Roadmap / DailyPlan. */
  async reconcileSubject(userId: string, subjectId: string): Promise<{ subjectId: string; signals: SignalView[] }> {
    const subject = await this.repo.getSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found');
    await this.evaluateSkills(userId, await this.repo.reconcileCandidateSkillIds(userId, subjectId)); // REPEATED_MISTAKE
    await this.evaluateStateSkills(userId, await this.repo.stateSignalCandidateSkillIds(userId, subjectId, STATE_SIGNAL_TYPES)); // WEAK_SKILL + REVIEW_DUE
    return this.getActiveSignals(userId, subjectId);
  }

  /** Current ACTIVE signals for principal + Subject (§32). */
  async getActiveSignals(userId: string, subjectId: string): Promise<{ subjectId: string; signals: SignalView[] }> {
    const subject = await this.repo.getSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found');
    const rows = await this.repo.activeSignalsForSubject(userId, subjectId);
    return {
      subjectId,
      signals: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        skill: r.skill ? { id: r.skill.id, name: r.skill.name } : null,
        createdAt: r.firstDetectedAt.toISOString(),
      })),
    };
  }
}
