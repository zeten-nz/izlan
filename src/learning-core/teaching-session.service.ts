import { Injectable } from '@nestjs/common';
import { ActivityType, MasteryEvaluationOutcome, PointAcquisitionType, Prisma, SkillMeasurementSource, TeachingSessionStatus } from '@prisma/client';
import {
  ActivityAttemptRequestConflictError,
  ActivityInvalidResponseError,
  RoadmapPointNotFoundError,
  TeachingActivityNotAvailableError,
  TeachingSessionNotFoundError,
  TeachingSessionNotResumableError,
} from '../common/errors';
import { getActivityDefinition } from '../content/activity/activity-registry';
import { parseInteractiveActivity, scoreInteractive, canonicalizeInteractive } from '../content/activity/activity-interaction';
import type { StructuredFeedback } from '../content/activity/structured-activity-scorer';
import { projectActivityForLearnerRuntime, LearnerProjectedActivity } from '../content/activity/learner-activity-projection';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { LearnerSignalsService } from '../learner-signals/learner-signals.service';
import { DailyMissionService } from '../daily-mission/daily-mission.service';
import { LearningCoreRepository, TeachablePoint, isUniqueViolation } from './learning-core.repository';
import {
  MasteryGates,
  TEACHING_MASTERY_DERIVATION_VERSION,
  TEACHING_MASTERY_EVALUATION_POLICY,
  deriveTeachingMastery,
  evaluateTeachingMastery,
} from './mastery/teaching-mastery.engine';
import { interactionKindOf } from '../content/activity/activity-interaction';
import { evidenceForActivity } from '../content/activity/activity-evidence';

const TERMINAL: TeachingSessionStatus[] = [TeachingSessionStatus.COMPLETED, TeachingSessionStatus.ABANDONED];

/** Honest, answer-key-free remediation: a canonical Present Simple rule reminder by stage type. */
const REMEDIATION: Record<string, string> = {
  concept: 'Present Simple odat, kundalik ish va umumiy faktlar uchun ishlatiladi: “I work every day.”',
  recognition: 'He/She/It bilan fe’lga -s qo‘shiladi: “She works.” I/You/We/They — qo‘shimchasiz.',
  production: 'Tasdiq: She works. Inkor: He doesn’t work. Savol: Do you work? / Does she work?',
  mastery: 'Eslang: he/she/it → -s; inkor don’t/doesn’t; savol do/does + asosiy fe’l.',
};
const REMEDIATION_DEFAULT = 'Present Simple: he/she/it bilan -s; inkor don’t/doesn’t; savol do/does.';

export type TeachingActivityView = LearnerProjectedActivity & {
  role: string;
  kind: 'OBJECTIVE' | 'VIEW_ONLY' | 'UNSUPPORTED';
  attempted: boolean;
  lastResult: { isCorrect: boolean; deterministicScore: number } | null;
};

export interface TeachingStageView {
  id: string;
  position: number;
  stageType: string;
  title: string;
  description: string;
  activities: TeachingActivityView[];
}

export interface TeachingMasteryStatusView {
  requiredSkillCount: number;
  outcome: string | null;
  satisfied: boolean;
  learned: boolean;
  canCheck: boolean;
  gates: unknown[] | null;
}

export interface TeachingSessionView {
  id: string;
  roadmapPointId: string;
  roadmapPointRevisionId: string;
  blueprintRevisionId: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  status: string;
  stages: TeachingStageView[];
  mastery: TeachingMasteryStatusView;
}

export interface TeachingAttemptView {
  attemptId: string;
  activityId: string;
  attemptNo: number;
  isCorrect: boolean;
  deterministicScore: number;
  remediation: string | null; // generic stage-typed nudge (choice); structured formats use `feedback`
  feedback: StructuredFeedback | null; // learner-safe structured feedback (hint code / incorrect blanks / authored remediation)
}

export interface MasteryCheckView {
  outcome: string;
  satisfied: boolean;
  learned: boolean;
  acquisitionId: string | null;
  gates: unknown[];
}

/**
 * V2 Teaching Session runtime. A session pins the point + blueprint revisions on first start and resumes them
 * without repinning. Objective submissions reuse the V1 server-side scorer, keep clientRequestId idempotency,
 * and append immutable ActivityAttempt evidence. Mastery-check derives TEACHING_MASTERY SkillMeasurements from
 * the exact mastery-stage attempts, recomputes LearnerSkillState through the single writer, pins the exact
 * evidence in a MasteryEvaluation, and — only when SATISFIED — records a LEARNED PointAcquisitionEvent. No fake
 * LessonCompletion is ever written. Own-user only (404-safe).
 */
@Injectable()
export class TeachingSessionService {
  constructor(
    private readonly repo: LearningCoreRepository,
    private readonly learningProgress: LearningProgressService,
    private readonly signals: LearnerSignalsService,
    private readonly missions: DailyMissionService,
  ) {}

  async startOrResume(userId: string, pointId: string): Promise<TeachingSessionView> {
    const existing = await this.repo.findNonTerminalSession(userId, pointId);
    if (existing) return this.buildView(userId, existing.id, existing);

    const point = await this.repo.getTeachablePoint(pointId);
    if (!point) throw new RoadmapPointNotFoundError('roadmap point not found or not teachable');

    const { bindings } = await this.repo.getStagesWithActivities(point.blueprintRevisionId);
    const lessonRevisionIds = [...new Set(bindings.map((b) => b.lessonRevisionId))];

    let session;
    try {
      session = await this.repo.createSession(userId, point, lessonRevisionIds);
    } catch (e) {
      if (isUniqueViolation(e)) {
        session = await this.repo.findNonTerminalSession(userId, pointId); // concurrent start won the non-terminal partial unique
      }
      if (!session) throw e;
    }
    return this.buildView(userId, session.id, session);
  }

  async getSession(userId: string, sessionId: string): Promise<TeachingSessionView> {
    const session = await this.repo.findOwnSession(userId, sessionId);
    if (!session) throw new TeachingSessionNotFoundError('teaching session not found');
    return this.buildView(userId, sessionId, session);
  }

  private async buildView(
    userId: string,
    sessionId: string,
    session: { id: string; roadmapPointId: string; roadmapPointRevisionId: string; blueprintRevisionId: string; status: TeachingSessionStatus },
  ): Promise<TeachingSessionView> {
    const point = await this.repo.getTeachablePoint(session.roadmapPointId);
    const { stages, bindings } = await this.repo.getStagesWithActivities(session.blueprintRevisionId);
    const attempts = await this.repo.sessionAttempts(userId, sessionId);

    // Best attempt per activity (highest deterministic score) for the resume/progress view.
    const bestByActivity = new Map<string, { isCorrect: boolean; deterministicScore: number }>();
    for (const a of attempts) {
      const prev = bestByActivity.get(a.activityId);
      const score = a.deterministicScore ?? 0;
      if (!prev || score > prev.deterministicScore) bestByActivity.set(a.activityId, { isCorrect: a.isCorrect ?? false, deterministicScore: score });
    }

    const stageViews: TeachingStageView[] = stages.map((s) => {
      const config = (s.config ?? {}) as { title?: string; description?: string };
      const acts = bindings
        .filter((b) => b.stageId === s.id)
        .map<TeachingActivityView>((b) => {
          const projected = projectActivityForLearnerRuntime({ id: b.activityId, type: b.type, position: b.position, payload: b.payload, media: b.media });
          const kind = getActivityDefinition(b.type).executionKind;
          const last = bestByActivity.get(b.activityId) ?? null;
          return { ...projected, role: b.role, kind, attempted: bestByActivity.has(b.activityId), lastResult: last };
        });
      return { id: s.id, position: s.position, stageType: s.stageType, title: config.title ?? s.stageType, description: config.description ?? '', activities: acts };
    });

    const latestEval = await this.repo.findLatestEvaluation(userId, session.roadmapPointId);
    const learned = await this.repo.hasLearnedAcquisition(userId, session.roadmapPointId);
    const masteryActivityIds = bindings.filter((b) => b.type === ActivityType.MASTERY_TEST).map((b) => b.activityId);
    const masteryAttempted = masteryActivityIds.some((id) => bestByActivity.has(id));

    return {
      id: session.id,
      roadmapPointId: session.roadmapPointId,
      roadmapPointRevisionId: session.roadmapPointRevisionId,
      blueprintRevisionId: session.blueprintRevisionId,
      title: point?.title ?? 'Roadmap point',
      learningOutcome: point?.learningOutcome ?? null,
      status: session.status,
      stages: stageViews,
      mastery: {
        requiredSkillCount: point?.requiredSkills.length ?? 0,
        outcome: latestEval?.outcome ?? null,
        satisfied: latestEval?.outcome === MasteryEvaluationOutcome.SATISFIED,
        learned,
        canCheck: masteryAttempted && !TERMINAL.includes(session.status),
        gates: latestEval ? ((latestEval.gateSummary as { gates?: unknown[] })?.gates ?? null) : null,
      },
    };
  }

  async submitActivity(userId: string, sessionId: string, activityId: string, clientRequestId: string, answer: Record<string, unknown>): Promise<TeachingAttemptView> {
    const session = await this.repo.findOwnSession(userId, sessionId);
    if (!session) throw new TeachingSessionNotFoundError('teaching session not found');
    if (TERMINAL.includes(session.status)) throw new TeachingSessionNotResumableError('teaching session is not resumable');

    const bound = await this.repo.findBoundActivity(session.blueprintRevisionId, activityId);
    if (!bound) throw new TeachingActivityNotAvailableError('activity is not part of this session');
    if (getActivityDefinition(bound.type).executionKind !== 'OBJECTIVE') throw new ActivityInvalidResponseError('activity is not answerable');

    // ONE interaction engine over choice + structured production, dispatched on the payload's schemaVersion.
    const activity = parseInteractiveActivity(bound.payload);

    // Idempotency by clientRequestId: replay an identical submission, conflict on a different one.
    const prior = await this.repo.findAttemptByClientRequest(userId, clientRequestId);
    if (prior) {
      if (prior.activityId !== activityId) throw new ActivityAttemptRequestConflictError('request id already used for a different activity');
      const sameAnswer = canonicalizeInteractive(activity, prior.answer as unknown) === canonicalizeInteractive(activity, answer);
      if (!sameAnswer) throw new ActivityAttemptRequestConflictError('request id already used with a different submission');
      return this.toAttemptView(prior.id, prior.activityId, prior.attemptNo, prior.isCorrect ?? false, prior.deterministicScore ?? 0, bound.stageType, null);
    }

    const score = scoreInteractive(activity, answer); // throws ActivityInvalidResponseError on malformed answers

    // Append-only create with attemptNo retry (mirrors V1 lesson attempts).
    let created: { id: string; activityId: string; attemptNo: number; isCorrect: boolean | null; deterministicScore: number | null } | null = null;
    for (let i = 0; i < 6; i++) {
      const attemptNo = (await this.repo.maxAttemptNo(userId, activityId)) + 1;
      try {
        created = await this.repo.createAttempt({
          userId,
          activityId,
          lessonRevisionId: bound.lessonRevisionId,
          teachingSessionId: sessionId,
          attemptNo,
          answer: answer as Prisma.InputJsonValue,
          isCorrect: score.isCorrect,
          deterministicScore: score.deterministicScore,
          clientRequestId,
        });
        break;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const replay = await this.repo.findAttemptByClientRequest(userId, clientRequestId);
        if (replay && replay.activityId === activityId) {
          // Concurrent duplicate → idempotent replay; the winning creation already fired signals, so don't re-fire.
          return this.toAttemptView(replay.id, replay.activityId, replay.attemptNo, replay.isCorrect ?? false, replay.deterministicScore ?? 0, bound.stageType, null);
        }
        // else attemptNo collision → retry with a fresh number
      }
    }
    if (!created) throw new ActivityAttemptRequestConflictError('could not record attempt (too many concurrent submissions)');

    // Evidence → mistake interpretation (the adaptive loop's first edge): a persisted objective teaching attempt
    // may activate/resolve a REPEATED_MISTAKE signal for the activity's skills — conservatively (3 distinct wrong
    // to activate, so one slip never does). Advisory + best-effort: a signal failure must never fail the learner's
    // answer submission (mirrors the recompute→state-signal hook, which owns WEAK_SKILL/REVIEW_DUE separately).
    await this.evaluateAttemptSignals(userId, activityId);
    // Objective teaching work is real "learning today" — evaluate daily missions (LEARN_TODAY, MASTERY_TEST_90).
    // Advisory: the mission/reward path is idempotent and never rolls back the answer; XP/IZL are only granted for
    // this REAL persisted attempt, never fabricated for a displayed daily task.
    await this.evaluateAttemptMissions(userId, created.id);

    return this.toAttemptView(created.id, created.activityId, created.attemptNo, created.isCorrect ?? false, created.deterministicScore ?? 0, bound.stageType, score.feedback ?? null);
  }

  /** Fire the REPEATED_MISTAKE detector for an attempted activity's skills. Never throws (advisory). */
  private async evaluateAttemptSignals(userId: string, activityId: string): Promise<void> {
    try {
      const skillIds = (await this.repo.activitySkillIds([activityId])).get(activityId) ?? [];
      if (skillIds.length > 0) await this.signals.evaluateSkills(userId, skillIds);
    } catch {
      // best-effort — signal evaluation is advisory and must not block the answer path
    }
  }

  /** Evaluate daily missions from a persisted teaching attempt (advisory, idempotent). Never throws. */
  private async evaluateAttemptMissions(userId: string, attemptId: string): Promise<void> {
    try {
      await this.missions.evaluateActivityAttempt(userId, attemptId);
    } catch {
      // best-effort — mission/reward evaluation is advisory and must not block the answer path
    }
  }

  private toAttemptView(attemptId: string, activityId: string, attemptNo: number, isCorrect: boolean, deterministicScore: number, stageType: string | undefined, feedback: StructuredFeedback | null): TeachingAttemptView {
    return {
      attemptId,
      activityId,
      attemptNo,
      isCorrect,
      deterministicScore,
      // Structured formats carry their own learner-safe feedback; choice falls back to the generic stage-typed nudge.
      remediation: isCorrect || feedback ? null : ((stageType && REMEDIATION[stageType]) ?? REMEDIATION_DEFAULT),
      feedback,
    };
  }

  async runMasteryCheck(userId: string, sessionId: string): Promise<MasteryCheckView> {
    const session = await this.repo.findOwnSession(userId, sessionId);
    if (!session) throw new TeachingSessionNotFoundError('teaching session not found');

    const point = await this.repo.getTeachablePoint(session.roadmapPointId);
    if (!point) throw new RoadmapPointNotFoundError('roadmap point not found or not teachable');

    // Already learned → idempotent replay of the terminal state.
    if (await this.repo.hasLearnedAcquisition(userId, session.roadmapPointId)) {
      const evalRow = await this.repo.findLatestEvaluation(userId, session.roadmapPointId);
      return { outcome: MasteryEvaluationOutcome.SATISFIED, satisfied: true, learned: true, acquisitionId: null, gates: gatesArray(evalRow?.gateSummary) };
    }

    const { bindings } = await this.repo.getStagesWithActivities(session.blueprintRevisionId);
    const masteryActivityIds = bindings.filter((b) => b.type === ActivityType.MASTERY_TEST).map((b) => b.activityId);
    const attempts = await this.repo.sessionAttempts(userId, sessionId);
    const masteryAttempts = attempts.filter((a) => masteryActivityIds.includes(a.activityId));

    const requiredSkillIds = point.requiredSkills.map((s) => s.skillId);
    if (masteryAttempts.length === 0) {
      return { outcome: MasteryEvaluationOutcome.INSUFFICIENT_EVIDENCE, satisfied: false, learned: false, acquisitionId: null, gates: [] };
    }

    // Best attempt per mastery activity + the contributing attempt ids + observed watermark.
    const bestByActivity = new Map<string, { score: number; attemptId: string }>();
    let observedAt = new Date(0);
    for (const a of masteryAttempts) {
      const score = a.deterministicScore ?? 0;
      const prev = bestByActivity.get(a.activityId);
      if (!prev || score > prev.score) bestByActivity.set(a.activityId, { score, attemptId: a.id });
      if (a.submittedAt && a.submittedAt > observedAt) observedAt = a.submittedAt;
    }
    if (observedAt.getTime() === 0) observedAt = new Date();

    const activitySkillIds = await this.repo.activitySkillIds([...bestByActivity.keys()]);
    const requiredSet = new Set(requiredSkillIds);
    // Honest per-activity evidence descriptor from the mastery activity's FORMAT (choice → recognition@1;
    // structured → controlled-production@2). No longer a single fabricated 'free-production' for the whole session.
    const evidenceByActivity = new Map(bindings.filter((b) => b.type === ActivityType.MASTERY_TEST).map((b) => [b.activityId, evidenceForActivity(interactionKindOf(b.payload) ?? 'CHOICE')]));
    const masteryInputs = [...bestByActivity.entries()].map(([activityId, v]) => ({
      activityId,
      bestScoreBp: v.score,
      evidenceKind: (evidenceByActivity.get(activityId) ?? evidenceForActivity('CHOICE')).evidenceKind,
      independenceLevel: (evidenceByActivity.get(activityId) ?? evidenceForActivity('CHOICE')).independenceLevel,
      skillIds: (activitySkillIds.get(activityId) ?? []).filter((id) => requiredSet.has(id)),
    }));

    const entries = deriveTeachingMastery(masteryInputs);
    // Per-skill contributing attempt ids (mastery activities attributed to that required skill).
    const attemptIdsBySkill = new Map<string, string[]>();
    for (const [activityId, v] of bestByActivity) {
      for (const skillId of activitySkillIds.get(activityId) ?? []) {
        if (!requiredSet.has(skillId)) continue;
        attemptIdsBySkill.set(skillId, [...(attemptIdsBySkill.get(skillId) ?? []), v.attemptId]);
      }
    }
    const expectationBySkill = new Map(point.requiredSkills.map((s) => [s.skillId, s.expectationRevisionId]));

    // 1) Append immutable TEACHING_MASTERY evidence + evidence refs (idempotent).
    const evidence = await this.repo.appendTeachingEvidence({
      userId,
      teachingSessionId: sessionId,
      source: SkillMeasurementSource.TEACHING_MASTERY,
      derivationVersion: TEACHING_MASTERY_DERIVATION_VERSION,
      observedAt,
      perSkill: entries.map((e) => ({
        skillId: e.skillId,
        scoreBp: e.scoreBp,
        confidenceBp: e.confidenceBp,
        evidenceCount: e.evidenceCount,
        evidenceKind: e.evidenceKind, // honest, per-skill (from the format of its mastery activities)
        independenceLevel: e.independenceLevel,
        expectationRevisionId: expectationBySkill.get(e.skillId) ?? null,
        attemptIds: attemptIdsBySkill.get(e.skillId) ?? [],
      })),
    });

    // 2) Recompute LearnerSkillState through the SINGLE writer (never write state directly).
    await this.learningProgress.recomputeSkills(userId, entries.map((e) => e.skillId));

    // 3) Evaluate the exact evidence against the gates.
    const gates = parseGates(point.masteryGates);
    const evaluation = evaluateTeachingMastery(requiredSkillIds, entries, gates);
    const gateSummary = { gates: evaluation.gates, thresholdBp: gates.thresholdBp, minIndependence: gates.minIndependence };

    // 4) Record the MasteryEvaluation + its exact evidence rows (idempotent by evidence watermark).
    const { evaluationId } = await this.repo.recordMasteryEvaluation({
      userId,
      roadmapPointId: session.roadmapPointId,
      roadmapPointRevisionId: session.roadmapPointRevisionId,
      requirementRevisionId: point.masteryRequirementRevisionId,
      outcome: evaluation.outcome as MasteryEvaluationOutcome,
      policyVersion: TEACHING_MASTERY_EVALUATION_POLICY,
      evidenceCutoffAt: observedAt,
      gateSummary: gateSummary as unknown as Prisma.InputJsonValue,
      measurementIds: evidence.map((e) => e.measurementId),
    });

    // 5) On SATISFIED, record the LEARNED acquisition + complete the session + refresh the projection cache.
    if (evaluation.outcome === 'SATISFIED') {
      const acquisition = await this.repo.recordLearnedAcquisition({
        userId,
        roadmapPointId: session.roadmapPointId,
        roadmapPointRevisionId: session.roadmapPointRevisionId,
        masteryEvaluationId: evaluationId,
        policyVersion: TEACHING_MASTERY_EVALUATION_POLICY,
      });
      await this.repo.markSessionCompleted(sessionId);
      const subjectId = await this.repo.subjectIdForPoint(session.roadmapPointId);
      if (subjectId) {
        const gen = await this.repo.findCurrentGeneration(userId, subjectId);
        if (gen) await this.repo.setProjectionAcquisition(gen.id, session.roadmapPointId, PointAcquisitionType.LEARNED);
      }
      return { outcome: evaluation.outcome, satisfied: true, learned: true, acquisitionId: acquisition.acquisitionId, gates: evaluation.gates };
    }

    return { outcome: evaluation.outcome, satisfied: false, learned: false, acquisitionId: null, gates: evaluation.gates };
  }
}

function parseGates(raw: Prisma.JsonValue): MasteryGates {
  const g = (raw ?? {}) as { thresholdBp?: unknown; minIndependence?: unknown };
  const thresholdBp = typeof g.thresholdBp === 'number' ? g.thresholdBp : 8000;
  const minIndependence = typeof g.minIndependence === 'number' ? g.minIndependence : 1;
  return { thresholdBp, minIndependence };
}

function gatesArray(raw: Prisma.JsonValue | undefined | null): unknown[] {
  const g = (raw ?? {}) as { gates?: unknown[] };
  return Array.isArray(g.gates) ? g.gates : [];
}
