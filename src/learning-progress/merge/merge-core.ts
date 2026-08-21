import { SkillMeasurementSource } from '@prisma/client';
import { LearningProgressConfigurationInvalidError, LearningProgressNoEffectiveEvidenceError } from '../../common/errors';

/**
 * Shared pure merge core for learning-progress-merge (v1 + v2). The math is identical across versions;
 * versions differ ONLY by which sources are supported/anchor/incremental (config). No I/O, clock, or randomness.
 */
export interface NormalizedMeasurement {
  id: string;
  source: SkillMeasurementSource;
  scoreBp: number; // 0..10000
  confidenceBp: number; // 0..10000
  evidenceCount: number; // >0
  observedAt: Date; // logical evidence time
}

export interface MergeResult {
  masteryScoreBp: number;
  confidenceBp: number;
  evidenceCount: number;
  lastMeasurementAt: Date;
  displayLevel: null;
  anchorMeasurementId: string | null;
  includedMeasurementIds: string[];
}

export interface MergeConfig {
  supportedSources: ReadonlySet<SkillMeasurementSource>; // anchors ∪ incremental
  anchorSources: ReadonlySet<SkillMeasurementSource>; // calibration recalibrators
  incrementalSources: ReadonlySet<SkillMeasurementSource>; // accumulate after the anchor
}

const anchorPriority = (s: SkillMeasurementSource): number => (s === SkillMeasurementSource.CHECKPOINT ? 1 : 0); // CHECKPOINT wins ties (§12/48)

/** Round a non-negative rational num/den half-up, exactly, using BigInt (no float). */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}

function assertNormalized(m: NormalizedMeasurement): void {
  const okBp = (v: number) => Number.isInteger(v) && v >= 0 && v <= 10000;
  if (!okBp(m.scoreBp) || !okBp(m.confidenceBp)) throw new LearningProgressConfigurationInvalidError('measurement score/confidence out of bounds');
  if (!Number.isInteger(m.evidenceCount) || m.evidenceCount <= 0) throw new LearningProgressConfigurationInvalidError('measurement evidenceCount must be a positive integer');
  if (!(m.observedAt instanceof Date) || Number.isNaN(m.observedAt.getTime())) throw new LearningProgressConfigurationInvalidError('measurement observedAt invalid');
}

/** Deterministic anchor pick: latest observedAt → CHECKPOINT over DIAGNOSTIC → greatest id (stable). */
function selectAnchor(candidates: NormalizedMeasurement[]): NormalizedMeasurement | null {
  let best: NormalizedMeasurement | null = null;
  for (const m of candidates) {
    if (best === null) { best = m; continue; }
    const t = m.observedAt.getTime() - best.observedAt.getTime();
    if (t > 0) { best = m; continue; }
    if (t < 0) continue;
    const p = anchorPriority(m.source) - anchorPriority(best.source);
    if (p > 0) { best = m; continue; }
    if (p < 0) continue;
    if (m.id > best.id) best = m; // final deterministic tie
  }
  return best;
}

/**
 * Pure weighted merge. Returns null when there is NO supported measurement (caller must not write/delete state).
 * Current window: anchor + incremental strictly after it; or, no anchor → all incremental.
 */
export function mergeWithConfig(measurements: NormalizedMeasurement[], config: MergeConfig): MergeResult | null {
  const supported = measurements.filter((m) => config.supportedSources.has(m.source));
  if (supported.length === 0) return null;
  for (const m of supported) assertNormalized(m);

  const anchor = selectAnchor(supported.filter((m) => config.anchorSources.has(m.source)));
  const included: NormalizedMeasurement[] = anchor
    ? [anchor, ...supported.filter((m) => config.incrementalSources.has(m.source) && m.observedAt.getTime() > anchor.observedAt.getTime())]
    : supported.filter((m) => config.incrementalSources.has(m.source));

  // effectiveWeight(m) = evidenceCount × confidenceBp (§17). BigInt accumulators — exact, no float drift.
  let masteryNum = 0n;
  let masteryDen = 0n;
  let confNum = 0n;
  let confDen = 0n;
  let evidenceCount = 0;
  let lastMs = -Infinity;
  for (const m of included) {
    const ec = BigInt(m.evidenceCount);
    const conf = BigInt(m.confidenceBp);
    const weight = ec * conf;
    masteryNum += BigInt(m.scoreBp) * weight;
    masteryDen += weight;
    confNum += conf * ec;
    confDen += ec;
    evidenceCount += m.evidenceCount;
    lastMs = Math.max(lastMs, m.observedAt.getTime());
  }

  if (masteryDen === 0n) throw new LearningProgressNoEffectiveEvidenceError('no effective evidence weight'); // §18

  const clamp = (v: bigint) => Math.min(10000, Math.max(0, Number(v)));
  return {
    masteryScoreBp: clamp(divRoundHalfUp(masteryNum, masteryDen)),
    confidenceBp: clamp(divRoundHalfUp(confNum, confDen)),
    evidenceCount,
    lastMeasurementAt: new Date(lastMs),
    displayLevel: null,
    anchorMeasurementId: anchor ? anchor.id : null,
    includedMeasurementIds: included.map((m) => m.id),
  };
}
