/**
 * Pure Placement V2 decision engine (placementThresholdPolicy/v1). No DB / HTTP / AI. Deterministic.
 *
 * Reuses the existing DIAGNOSTIC SkillMeasurement evidence (masteryScoreBp/confidenceBp/evidenceCount, all
 * basis points 0..10000). It never redefines confidence (= coverage). Thresholds are versioned config, never
 * inline UI constants. "Not assessed" is a distinct value from 0 — absence, never a zero band.
 */
export const PLACEMENT_THRESHOLD_POLICY_VERSION = 'placementThresholdPolicy/v1';
export const PLACEMENT_APPLICATION_POLICY_VERSION = 'placement-roadmap-application-v1';
export const PLACEMENT_DECISION_DERIVATION_VERSION = 'placement-v2-decision-v1';

export interface PlacementThresholds {
  validateBp: number; // >= this (with sufficient evidence) → a skill/point is VALIDATED (skippable)
  continueBp: number; // below this → weak (needs repair)
  rebuildBp: number; // level-band floor for "rebuild" vs "prerequisite fallback"
  minEvidenceCount: number; // evidence units required before any validation/weak call
}

/** Default A1 thresholds (Methodist-tunable; stored with the decision as policyVersion). */
export const DEFAULT_PLACEMENT_THRESHOLDS: PlacementThresholds = {
  validateBp: 9500,
  continueBp: 8000,
  rebuildBp: 5000,
  minEvidenceCount: 1,
};

export type DecisionType = 'FRESH_START' | 'LEVEL_VALIDATED' | 'CONTINUE_WITH_REPAIR' | 'REBUILD_LEVEL' | 'PREREQUISITE_FALLBACK';
export type SkillPlacementState = 'VALIDATED' | 'COMPETENT' | 'WEAK' | 'UNASSESSED';
export type PointPlacementOutcome = 'VALIDATED' | 'WEAK' | 'AVAILABLE' | 'UNASSESSED';
export type DomainAssessmentState = 'MEASURED' | 'NOT_ASSESSED';

export interface SkillDiagnostic {
  skillId: string;
  masteryScoreBp: number;
  confidenceBp: number; // coverage; falls back to 10000 when null
  evidenceCount: number;
}

export interface PointInput {
  roadmapPointId: string;
  requiredSkillIds: string[];
}

export interface SkillClassification {
  skillId: string;
  state: SkillPlacementState;
  masteryScoreBp: number | null; // null → no evidence
  evidenceCount: number;
}

export interface PointClassification {
  roadmapPointId: string;
  outcome: PointPlacementOutcome;
  requiredSkillIds: string[];
}

export interface DomainBand {
  domainCode: string;
  state: DomainAssessmentState;
  bandBp: number | null; // null when NOT_ASSESSED
  skillCount: number;
}

export function classifySkill(m: SkillDiagnostic | undefined, t: PlacementThresholds): SkillPlacementState {
  if (!m || m.evidenceCount < t.minEvidenceCount) return 'UNASSESSED';
  if (m.masteryScoreBp >= t.validateBp) return 'VALIDATED';
  if (m.masteryScoreBp < t.continueBp) return 'WEAK';
  return 'COMPETENT';
}

/** A point VALIDATED iff every required skill VALIDATED; WEAK if any weak; UNASSESSED if all unassessed; else AVAILABLE. */
export function classifyPoints(points: PointInput[], byId: Map<string, SkillDiagnostic>, t: PlacementThresholds): PointClassification[] {
  return points.map((p) => {
    const states = p.requiredSkillIds.map((id) => classifySkill(byId.get(id), t));
    let outcome: PointPlacementOutcome;
    if (states.length > 0 && states.every((s) => s === 'VALIDATED')) outcome = 'VALIDATED';
    else if (states.some((s) => s === 'WEAK')) outcome = 'WEAK';
    else if (states.length > 0 && states.every((s) => s === 'UNASSESSED')) outcome = 'UNASSESSED';
    else outcome = 'AVAILABLE';
    return { roadmapPointId: p.roadmapPointId, outcome, requiredSkillIds: p.requiredSkillIds };
  });
}

export function classifySkills(skillIds: string[], byId: Map<string, SkillDiagnostic>, t: PlacementThresholds): SkillClassification[] {
  return skillIds.map((skillId) => {
    const m = byId.get(skillId);
    return { skillId, state: classifySkill(m, t), masteryScoreBp: m ? m.masteryScoreBp : null, evidenceCount: m?.evidenceCount ?? 0 };
  });
}

/** effectiveWeight = evidenceCount × confidenceBp (the merge weight) — a band cannot be swung by thin evidence. */
function weightedBand(ms: SkillDiagnostic[]): number | null {
  let num = 0n;
  let den = 0n;
  for (const m of ms) {
    const w = BigInt(m.evidenceCount) * BigInt(m.confidenceBp);
    num += BigInt(m.masteryScoreBp) * w;
    den += w;
  }
  if (den === 0n) return null;
  return Number((2n * num + den) / (2n * den)); // half-up
}

/** Per-domain band over skills whose primary domain is that domain and that have evidence. Absence → NOT_ASSESSED. */
export function domainBands(domainCodes: string[], skillDomain: Map<string, string>, measured: SkillDiagnostic[], t: PlacementThresholds): DomainBand[] {
  const withEvidence = measured.filter((m) => m.evidenceCount >= t.minEvidenceCount);
  const byDomain = new Map<string, SkillDiagnostic[]>();
  for (const m of withEvidence) {
    const d = skillDomain.get(m.skillId);
    if (!d) continue;
    byDomain.set(d, [...(byDomain.get(d) ?? []), m]);
  }
  return domainCodes.map((domainCode) => {
    const ms = byDomain.get(domainCode) ?? [];
    const band = weightedBand(ms);
    return { domainCode, state: band === null ? 'NOT_ASSESSED' : 'MEASURED', bandBp: band, skillCount: ms.length };
  });
}

/** Overall demonstrated band across every measured skill (weighted). Null if nothing measured. */
export function overallBand(measured: SkillDiagnostic[], t: PlacementThresholds): number | null {
  return weightedBand(measured.filter((m) => m.evidenceCount >= t.minEvidenceCount));
}

/** Level decisionType from the overall band + the required-domain-floor / coverage gate (multi-factor). */
export function decideLevel(overall: number | null, requiredDomainsSufficient: boolean, anyWeakPoint: boolean, t: PlacementThresholds): DecisionType {
  if (overall === null) return 'PREREQUISITE_FALLBACK'; // measured nothing meaningful
  if (overall >= t.validateBp && requiredDomainsSufficient && !anyWeakPoint) return 'LEVEL_VALIDATED';
  if (overall >= t.continueBp) return 'CONTINUE_WITH_REPAIR';
  if (overall >= t.rebuildBp) return 'REBUILD_LEVEL';
  return 'PREREQUISITE_FALLBACK';
}
