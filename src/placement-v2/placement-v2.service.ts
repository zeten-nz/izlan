import { Injectable } from '@nestjs/common';
import { PointAcquisitionType, Prisma, RoadmapAvailabilityState } from '@prisma/client';
import { PlacementSubjectNotAvailableError, PlacementDiagnosticNotReadyError, PlacementAttemptNotFoundError } from '../common/errors';
import { SkillProfileService } from '../skill-profile/skill-profile.service';
import {
  DEFAULT_PLACEMENT_THRESHOLDS,
  PLACEMENT_APPLICATION_POLICY_VERSION,
  PLACEMENT_THRESHOLD_POLICY_VERSION,
  PLACEMENT_DECISION_DERIVATION_VERSION,
  type DecisionType,
  type PointPlacementOutcome,
  type SkillDiagnostic,
  classifyPoints,
  classifySkills,
  decideLevel,
  domainBands,
  overallBand,
} from './placement-v2.engine';
import { PlacementV2Repository, PointWithSkills, ProjectionPlan, ValidatedTarget } from './placement-v2.repository';

export const PLACEMENT_V2_ENGINE_VERSION = 'v2-placement-roadmap-v1';
const ASSESSED_DOMAINS = new Set(['GRAMMAR', 'VOCABULARY']); // domains the A1 objective diagnostic actually covers

export interface PlacementDomainView {
  code: string;
  name: string;
  state: 'MEASURED' | 'NOT_ASSESSED';
  bandBp: number | null;
}

export interface PlacementPointView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  outcome: PointPlacementOutcome;
  bandBp: number | null; // weakest measured required-skill band (illustrative)
}

export interface PlacementResultView {
  decisionId: string;
  decisionType: DecisionType;
  entryIntent: 'NEW' | 'CLAIMS_LEVEL';
  claimedLevel: string | null;
  demonstratedLevel: string | null;
  overallBp: number | null;
  recommendedStart: { roadmapPointId: string; title: string } | null;
  domains: PlacementDomainView[];
  points: PlacementPointView[];
  summary: { validatedCount: number; weakCount: number; availableCount: number; unassessedCount: number };
  policyVersion: string;
}

@Injectable()
export class PlacementV2Service {
  constructor(
    private readonly repo: PlacementV2Repository,
    private readonly skillProfile: SkillProfileService,
  ) {}

  /** NEW learner: no diagnostic, FRESH_START decision, full available progression from the beginning. */
  async startFromZero(userId: string, subjectId: string, clientRequestId: string | null): Promise<PlacementResultView> {
    const ctx = await this.repo.resolveSubjectContext(subjectId);
    if (!ctx) throw new PlacementSubjectNotAvailableError('subject not available');
    const points = await this.repo.publishedPointsWithSkills(ctx.levelIds);
    if (points.length === 0) throw new PlacementSubjectNotAvailableError('no published roadmap points for subject');

    const domainDefs = await this.repo.subjectDomains(subjectId);
    const learnedIds = await this.repo.previouslyLearnedPointIds(userId, points.map((p) => p.roadmapPointId));
    const availability = computeAvailability(points, new Set(learnedIds));

    const projections: ProjectionPlan[] = points.map((p) => ({
      roadmapPointId: p.roadmapPointId,
      roadmapPointRevisionId: p.roadmapPointRevisionId,
      sortOrder: p.sortOrder,
      availability: availability.get(p.roadmapPointId) ?? RoadmapAvailabilityState.LOCKED,
      acquisition: learnedIds.has(p.roadmapPointId) ? PointAcquisitionType.LEARNED : null,
    }));

    const result: Omit<PlacementResultView, 'decisionId'> = {
      decisionType: 'FRESH_START',
      entryIntent: 'NEW',
      claimedLevel: null,
      demonstratedLevel: null,
      overallBp: null,
      recommendedStart: points[0] ? { roadmapPointId: points[0].roadmapPointId, title: points[0].title } : null,
      domains: domainDefs.map((d) => ({ code: d.code, name: d.name, state: 'NOT_ASSESSED', bandBp: null })),
      points: points.map((p) => ({ roadmapPointId: p.roadmapPointId, pointKey: p.pointKey, title: p.title, outcome: 'AVAILABLE' as PointPlacementOutcome, bandBp: null })),
      summary: { validatedCount: 0, weakCount: 0, availableCount: points.length, unassessedCount: 0 },
      policyVersion: PLACEMENT_THRESHOLD_POLICY_VERSION,
    };

    const recommendedStudyLevelId = await this.repo.recommendedLevelForSubject(ctx.levelIds);
    const applied = await this.repo.applyPlacement({
      userId, subjectId, trackId: ctx.trackId, sourceAttemptId: null, clientRequestId,
      policyVersion: PLACEMENT_THRESHOLD_POLICY_VERSION, applicationPolicyVersion: PLACEMENT_APPLICATION_POLICY_VERSION,
      recommendedStudyLevelId, snapshot: result as unknown as Prisma.InputJsonValue, engineVersion: PLACEMENT_V2_ENGINE_VERSION,
      projections, validatedTargets: [],
    });
    return { decisionId: applied.decisionId, ...result };
  }

  /** Experienced learner: finalize placement from a completed diagnostic → validated/weak/gap profile + roadmap. */
  async finalizeFromDiagnostic(userId: string, attemptId: string): Promise<PlacementResultView> {
    const attempt = await this.repo.findOwnCompletedDiagnostic(userId, attemptId);
    if (!attempt) throw new PlacementAttemptNotFoundError('completed diagnostic attempt not found');
    // Ensure DIAGNOSTIC evidence is derived (idempotent; single-writer merge). Then read it.
    await this.skillProfile.ensureDiagnosticDerived(userId, attemptId);
    const measurements = await this.repo.diagnosticMeasurements(userId, attemptId);
    if (measurements.length === 0) throw new PlacementDiagnosticNotReadyError('diagnostic evidence not available');

    const ctx = await this.repo.resolveSubjectContext(attempt.subjectId);
    if (!ctx) throw new PlacementSubjectNotAvailableError('subject not available');
    const points = await this.repo.publishedPointsWithSkills(ctx.levelIds);
    const domainDefs = await this.repo.subjectDomains(attempt.subjectId);

    const t = DEFAULT_PLACEMENT_THRESHOLDS;
    const diag: SkillDiagnostic[] = measurements.map((m) => ({ skillId: m.skillId, masteryScoreBp: m.scoreBp, confidenceBp: m.confidenceBp ?? 10000, evidenceCount: m.evidenceCount }));
    const byId = new Map(diag.map((d) => [d.skillId, d]));

    // Per-skill classification, per-point outcomes, per-domain bands, overall band.
    const skillDomain = new Map<string, string>();
    for (const p of points) for (const s of p.requiredSkills) if (s.skillCode) skillDomain.set(s.skillId, domainOfSkill(s.skillCode));
    const bands = domainBands(domainDefs.map((d) => d.code), skillDomain, diag, t);
    const overall = overallBand(diag, t);
    const pointClasses = classifyPoints(points.map((p) => ({ roadmapPointId: p.roadmapPointId, requiredSkillIds: p.requiredSkills.map((s) => s.skillId) })), byId, t);
    const outcomeByPoint = new Map(pointClasses.map((c) => [c.roadmapPointId, c.outcome]));

    const requiredDomainsSufficient = domainDefs.filter((d) => ASSESSED_DOMAINS.has(d.code)).every((d) => bands.find((b) => b.domainCode === d.code)?.state === 'MEASURED');
    const anyWeakPoint = pointClasses.some((c) => c.outcome === 'WEAK');
    const decisionType = decideLevel(overall, requiredDomainsSufficient, anyWeakPoint, t);

    // Availability: validated + previously-learned points acknowledged; dependents unlock once prereqs acquired.
    const validatedIds = new Set(pointClasses.filter((c) => c.outcome === 'VALIDATED').map((c) => c.roadmapPointId));
    const learnedIds = await this.repo.previouslyLearnedPointIds(userId, points.map((p) => p.roadmapPointId));
    const acquired = new Set<string>([...validatedIds, ...learnedIds]);
    const availability = computeAvailability(points, acquired);

    const projections: ProjectionPlan[] = points.map((p) => ({
      roadmapPointId: p.roadmapPointId,
      roadmapPointRevisionId: p.roadmapPointRevisionId,
      sortOrder: p.sortOrder,
      availability: availability.get(p.roadmapPointId) ?? RoadmapAvailabilityState.LOCKED,
      acquisition: validatedIds.has(p.roadmapPointId) ? PointAcquisitionType.VALIDATED : learnedIds.has(p.roadmapPointId) ? PointAcquisitionType.LEARNED : null,
    }));
    const validatedTargets: ValidatedTarget[] = points.filter((p) => validatedIds.has(p.roadmapPointId)).map((p) => ({ roadmapPointId: p.roadmapPointId, roadmapPointRevisionId: p.roadmapPointRevisionId }));

    const skillClasses = classifySkills([...byId.keys()], byId, t);
    const bandByPoint = new Map(points.map((p) => {
      const measuredBands = p.requiredSkills.map((s) => byId.get(s.skillId)).filter((m): m is SkillDiagnostic => Boolean(m)).map((m) => m.masteryScoreBp);
      return [p.roadmapPointId, measuredBands.length ? Math.min(...measuredBands) : null] as const;
    }));
    void skillClasses;

    const firstGap = points.find((p) => !validatedIds.has(p.roadmapPointId)) ?? null;
    const levelCode = await this.repo.primaryLevelCode(ctx.levelIds);

    const result: Omit<PlacementResultView, 'decisionId'> = {
      decisionType,
      entryIntent: 'CLAIMS_LEVEL',
      claimedLevel: levelCode,
      demonstratedLevel: decisionType === 'LEVEL_VALIDATED' ? levelCode : null,
      overallBp: overall,
      recommendedStart: firstGap ? { roadmapPointId: firstGap.roadmapPointId, title: firstGap.title } : null,
      domains: bands.map((b) => ({ code: b.domainCode, name: domainDefs.find((d) => d.code === b.domainCode)?.name ?? b.domainCode, state: b.state, bandBp: b.bandBp })),
      points: points.map((p) => ({ roadmapPointId: p.roadmapPointId, pointKey: p.pointKey, title: p.title, outcome: outcomeByPoint.get(p.roadmapPointId) ?? 'AVAILABLE', bandBp: bandByPoint.get(p.roadmapPointId) ?? null })),
      summary: {
        validatedCount: pointClasses.filter((c) => c.outcome === 'VALIDATED').length,
        weakCount: pointClasses.filter((c) => c.outcome === 'WEAK').length,
        availableCount: pointClasses.filter((c) => c.outcome === 'AVAILABLE').length,
        unassessedCount: pointClasses.filter((c) => c.outcome === 'UNASSESSED').length,
      },
      policyVersion: PLACEMENT_THRESHOLD_POLICY_VERSION,
    };

    const recommendedStudyLevelId = await this.repo.recommendedLevelForSubject(ctx.levelIds);
    const applied = await this.repo.applyPlacement({
      userId, subjectId: attempt.subjectId, trackId: attempt.trackId ?? ctx.trackId, sourceAttemptId: attemptId, clientRequestId: null,
      policyVersion: PLACEMENT_THRESHOLD_POLICY_VERSION, applicationPolicyVersion: PLACEMENT_APPLICATION_POLICY_VERSION,
      recommendedStudyLevelId, snapshot: result as unknown as Prisma.InputJsonValue, engineVersion: PLACEMENT_V2_ENGINE_VERSION,
      projections, validatedTargets,
    });
    void PLACEMENT_DECISION_DERIVATION_VERSION;
    return { decisionId: applied.decisionId, ...result };
  }

  /** The learner's latest placement decision result (immutable, decision-time snapshot), or null. */
  async getResult(userId: string, subjectId: string): Promise<PlacementResultView | null> {
    const decision = await this.repo.findLatestDecision(userId, subjectId);
    if (!decision) return null;
    const snapshot = decision.snapshot as unknown as Omit<PlacementResultView, 'decisionId'>;
    return { decisionId: decision.id, ...snapshot };
  }
}

function domainOfSkill(skillCode: string): string {
  // Grammar unless the code is a lexical/vocabulary skill (kept in sync with the A1 provisioner).
  const vocab = ['GREETINGS', 'NUMBERS', 'PERSONAL-INFO', 'FAMILY-VOCAB'];
  return vocab.some((v) => skillCode.includes(v)) ? 'VOCABULARY' : 'GRAMMAR';
}

/** A point is AVAILABLE iff every prerequisite is acquired (validated or learned); acquired points stay AVAILABLE; else LOCKED. */
function computeAvailability(points: PointWithSkills[], acquired: Set<string>): Map<string, RoadmapAvailabilityState> {
  const out = new Map<string, RoadmapAvailabilityState>();
  for (const p of points) {
    if (acquired.has(p.roadmapPointId)) { out.set(p.roadmapPointId, RoadmapAvailabilityState.AVAILABLE); continue; }
    const ready = p.prerequisitePointIds.every((pre) => acquired.has(pre));
    out.set(p.roadmapPointId, ready ? RoadmapAvailabilityState.AVAILABLE : RoadmapAvailabilityState.LOCKED);
  }
  return out;
}
