import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  AssessmentAttemptNotFoundError,
  AssessmentConfigurationInvalidError,
  ResourceNotFoundError,
  SkillProfileNotDerivedError,
} from '../common/errors';
import { parsePlacementConfig } from '../assessment/engine/placement-config';
import { PLACEMENT_ENGINE_VERSION } from '../assessment/engine/placement-engine.types';
import { DiagnosticSkillProfileEngine } from './derivation/diagnostic-profile.engine';
import { SKILL_PROFILE_DIAGNOSTIC_VERSION } from './derivation/diagnostic-profile.types';
import { SkillProfileRepository } from './skill-profile.repository';
import { LearningProgressService } from '../learning-progress/learning-progress.service';

export interface SkillStateView {
  skillId: string;
  name: string;
  masteryScoreBp: number;
  confidenceBp: number | null;
  evidenceCount: number;
  displayLevel: string | null; // null in v1 (§5/43)
  lastMeasurementAt: string | null;
}

/**
 * Skill Profile derivation + read APIs (Phase 1.5C). Evidence → SkillMeasurement (append-only) +
 * LearnerSkillState (current). No Roadmap / LearnerSignal / XP / IZL / AI (§64/65/66).
 */
@Injectable()
export class SkillProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: SkillProfileRepository,
    private readonly engine: DiagnosticSkillProfileEngine,
    private readonly learningProgress: LearningProgressService,
  ) {}

  /**
   * Idempotently derive + persist the diagnostic Skill Profile for one completed attempt (§28/29/30).
   * Safe to call repeatedly (auto after completion + repair endpoint): append-only measurement is
   * deduped by the DB idempotency index; current state is chronology-guarded.
   */
  async ensureDiagnosticDerived(userId: string, attemptId: string): Promise<void> {
    const attempt = await this.repo.findOwnCompletedDiagnostic(userId, attemptId);
    if (!attempt) throw new AssessmentAttemptNotFoundError('attempt not found');
    if (attempt.engineVersion !== PLACEMENT_ENGINE_VERSION) throw new AssessmentConfigurationInvalidError('unsupported engine version');
    if (!attempt.completedAt) throw new AssessmentConfigurationInvalidError('attempt missing completion time');

    const versionRow = await this.repo.findVersionConfig(attempt.definitionVersionId);
    if (!versionRow) throw new AssessmentConfigurationInvalidError('pinned version missing');
    const config = parsePlacementConfig(versionRow.config); // includes profileScale

    const pool = await this.repo.poolItems(attempt.definitionVersionId);
    const responses = await this.repo.orderedResponses(attemptId);

    // §21/54 subject scope (L-3): every answered item's Skill must belong to the attempt's Subject.
    const answeredItemIds = new Set(responses.map((r) => r.itemId));
    const answeredSkillIds = [...new Set(pool.filter((p) => answeredItemIds.has(p.itemId)).map((p) => p.skillId))];
    const skills = await this.repo.skillsByIds(answeredSkillIds);
    const subjectOf = new Map(skills.map((s) => [s.id, s.subjectId]));
    for (const sid of answeredSkillIds) {
      if (subjectOf.get(sid) !== attempt.subjectId) throw new AssessmentConfigurationInvalidError('cross-subject evidence');
    }

    const entries = this.engine.derive(config, pool, responses);
    if (entries.length === 0) return; // no answered-skill evidence → nothing to persist (§22)

    const measurementAt = attempt.completedAt; // logical observation time (TD-113)
    // Phase 1: append-only DIAGNOSTIC measurements (idempotent). Phase 2: merge → current state.
    await this.repo.createMeasurements(
      entries.map((e) => ({
        userId,
        skillId: e.skillId,
        attemptId,
        scoreBp: e.masteryScoreBp,
        confidenceBp: e.confidenceBp,
        evidenceCount: e.evidenceCount,
        observedAt: measurementAt,
        derivationVersion: SKILL_PROFILE_DIAGNOSTIC_VERSION,
      })),
    );
    // LearnerSkillState is written ONLY by the merge engine (TD-115). Diagnostic-only history reproduces the
    // previous 1.5C state exactly (single DIAGNOSTIC milestone → mastery=score, confidence, evidenceCount).
    await this.learningProgress.recomputeSkills(userId, entries.map((e) => e.skillId));
  }

  /** Current Skill Profile for principal + Subject (§31). */
  async getCurrentProfile(userId: string, subjectId: string): Promise<{ subject: { id: string; title: string }; skills: SkillStateView[] }> {
    const subject = await this.repo.getSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found');
    const states = await this.repo.subjectSkillStates(userId, subjectId);
    return {
      subject,
      skills: states.map((s) => ({
        skillId: s.skillId,
        name: s.skill.name,
        masteryScoreBp: s.masteryScoreBp,
        confidenceBp: s.confidenceBp,
        evidenceCount: s.evidenceCount,
        displayLevel: s.displayLevel,
        lastMeasurementAt: s.lastMeasurementAt ? s.lastMeasurementAt.toISOString() : null,
      })),
    };
  }

  /** The diagnostic milestone snapshot for one owned completed attempt (§32). */
  async getDiagnosticSnapshot(userId: string, attemptId: string) {
    const attempt = await this.repo.findOwnCompletedDiagnostic(userId, attemptId);
    if (!attempt) throw new AssessmentAttemptNotFoundError('attempt not found');
    const measurements = await this.repo.attemptMeasurements(attemptId, SKILL_PROFILE_DIAGNOSTIC_VERSION);
    if (measurements.length === 0) throw new SkillProfileNotDerivedError('skill profile not derived');
    return {
      attemptId,
      derivationVersion: SKILL_PROFILE_DIAGNOSTIC_VERSION,
      skills: measurements.map((m) => ({
        skillId: m.skillId,
        name: m.skill.name,
        masteryScoreBp: m.scoreBp,
        confidenceBp: m.confidenceBp,
        displayLevel: m.displayLevel,
        measuredAt: m.createdAt.toISOString(),
      })),
    };
  }
}
